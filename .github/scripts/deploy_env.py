#!/usr/bin/env python3
"""Roll the wp-updates-dashboard Central Manager component onto its self-hosted stack via the Coolify API.

Used by .github/workflows/deploy.yml on the self-hosted runner (the Coolify API is
loopback-only on the VPS). Flow, from the proven manual recipe:

  1. point the builder (frontend) app at the env's branch
  2. force-rebuild it, poll the deployment until it finishes
  3. read the built image tag (``<builder-uuid>:<commit-sha>``) from the logs
  4. repin that image in the stack's docker-compose and full-redeploy the stack
  5. probe the loopback origin until the stack serves again

Usage: deploy_env.py <staging|prod>
Env:   COOLIFY_API_TOKEN (required), GITHUB_SHA (image-tag fallback)
"""

import base64
import json
import os
import re
import sys
import time
import urllib.request

API = "http://localhost:8000/api/v1"

CONFIG = {
    "staging": {
        "service_uuid": "9uqjifcihlma602wrwu1zqqx",
        "frontend": ("fapuq2anqqob5m6ukcpyohhx", "staging"),
        "loopback": "http://127.0.0.1:6360",
        "public": "https://staging-wp-updates-dashboard.ystvps.com",
    },
    "prod": {
        "service_uuid": "amlobebvpoofsesa4yjho4pn",
        "frontend": ("itiwu2f9nmmuadkfergjy8og", "main"),
        "loopback": "http://127.0.0.1:5360",
        "public": "https://wp-updates-dashboard.ystvps.com",
    },
}

BUILD_TIMEOUT = 25 * 60
HEALTH_TIMEOUT = 3 * 60


def api(method, path, body=None):
    req = urllib.request.Request(
        f"{API}/{path}", method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={"Authorization": f"Bearer {TOKEN}",
                 "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r:
        raw = r.read().decode()
    return json.loads(raw, strict=False) if raw.strip() else {}


def log(msg):
    print(f"[deploy_env] {msg}", flush=True)


def trigger_build(builder, branch):
    api("PATCH", f"applications/{builder}", {"git_branch": branch})
    resp = api("POST", f"applications/{builder}/start?force=true")
    dep = resp.get("deployment_uuid")
    if not dep:
        raise SystemExit(f"[deploy_env] no deployment_uuid in trigger response: {resp}")
    return dep


def wait_build(deployment_uuid):
    deadline = time.time() + BUILD_TIMEOUT
    while time.time() < deadline:
        d = api("GET", f"deployments/{deployment_uuid}")
        status = d.get("status", "")
        if status in ("finished", "failed", "cancelled-by-user"):
            if status != "finished":
                log(f"build {status}; logs tail:\n{str(d.get('logs'))[-1500:]}")
                raise SystemExit(f"[deploy_env] build did not finish: {status}")
            return d
        time.sleep(10)
    raise SystemExit("[deploy_env] build timed out")


def image_tag(builder, deployment):
    logs = str(deployment.get("logs") or "")
    hits = re.findall(rf"{re.escape(builder)}:([0-9a-f]{{40}})", logs)
    if hits:
        return f"{builder}:{hits[-1]}"
    sha = os.environ.get("GITHUB_SHA", "")
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise SystemExit("[deploy_env] cannot determine built image tag")
    return f"{builder}:{sha}"


def repin_and_deploy(service_uuid, builder, tag):
    svc = api("GET", f"services/{service_uuid}")
    comp = svc.get("docker_compose_raw") or ""
    if "image:" not in comp:
        comp = base64.b64decode(comp).decode()
    new_comp, n = re.subn(
        rf"(?m)^(\s*image:\s*){re.escape(builder)}:\S+",
        rf"\g<1>{tag}", comp)
    if n != 1:
        raise SystemExit(f"[deploy_env] expected 1 image pin for {builder}, replaced {n}")
    api("PATCH", f"services/{service_uuid}",
        {"docker_compose_raw": base64.b64encode(new_comp.encode()).decode()})
    api("POST", f"deploy?uuid={service_uuid}")
    log(f"stack {service_uuid} redeploying with {tag}")


def wait_healthy(loopback):
    req = urllib.request.Request(loopback,
                                 headers={"User-Agent": "yst-deploy/1.0"})
    deadline = time.time() + HEALTH_TIMEOUT
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(req, timeout=10) as r:
                if r.status < 500:
                    return
        except Exception:
            pass
        time.sleep(5)
    raise SystemExit(f"[deploy_env] stack did not serve on {loopback}")


def main():
    global TOKEN
    TOKEN = os.environ.get("COOLIFY_API_TOKEN", "")
    if not TOKEN:
        raise SystemExit("COOLIFY_API_TOKEN is required")
    env = sys.argv[1]
    cfg = CONFIG[env]
    builder, branch = cfg["frontend"]
    log(f"{env}/frontend: builder {builder} <- branch {branch}")
    dep = trigger_build(builder, branch)
    log(f"build started: deployment {dep}")
    deployment = wait_build(dep)
    tag = image_tag(builder, deployment)
    log(f"built image {tag}")
    repin_and_deploy(cfg["service_uuid"], builder, tag)
    wait_healthy(cfg["loopback"])
    log(f"{env}/frontend DONE — live at {cfg['public']}")


if __name__ == "__main__":
    main()
