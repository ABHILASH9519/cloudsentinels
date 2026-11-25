#!/usr/bin/env python3
"""Compile release artifacts on demand; no service launch or deployment."""
import argparse
import os
from pathlib import Path
import shutil
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "artifacts"
TARGETS = (("linux", "amd64"), ("linux", "arm64"),
           ("windows", "amd64"), ("darwin", "arm64"))


def call(args, **kwargs):
    subprocess.run(args, cwd=ROOT, check=True, **kwargs)


def build_go(name, target, os_name, arch, destination, tags=None):
    destination.parent.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "CGO_ENABLED": "0", "GOOS": os_name, "GOARCH": arch}
    args = ["go", "build", "-mod=readonly", "-trimpath", "-ldflags=-s -w"]
    if tags:
        args += ["-tags", tags]
    call([*args, "-o", str(destination), target], env=env)
    print(f"Built {name}: {destination.relative_to(ROOT)}")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--frontend", action="store_true", help="install locked pnpm dependencies and compile dashboard")
    args = parser.parse_args()
    call(["go", "mod", "download"])
    for os_name, arch in TARGETS:
        folder = OUTPUT / f"{os_name}-{arch}"
        suffix = ".exe" if os_name == "windows" else ""
        for name in ("cloudsentinels", "cloudsentinels-agent"):
            build_go(name, "./cmd/" + name, os_name, arch, folder / (name + suffix))
    bootstrap = OUTPUT / "lambda-arm64" / "bootstrap"
    build_go("Lambda", "./cmd/cloudsentinels-lambda", "linux", "arm64", bootstrap, "lambda.norpc")
    shutil.copyfile(ROOT / "deploy/eks/airtable-inventory.snapshot.json",
                    bootstrap.parent / "airtable-inventory.snapshot.json")
    with zipfile.ZipFile(OUTPUT / "cloudsentinels-lambda-arm64.zip", "w", zipfile.ZIP_DEFLATED) as archive:
        executable = zipfile.ZipInfo("bootstrap")
        executable.create_system = 3
        executable.external_attr = 0o100755 << 16
        archive.writestr(executable, bootstrap.read_bytes(), compress_type=zipfile.ZIP_DEFLATED)
        archive.write(bootstrap.parent / "airtable-inventory.snapshot.json", "airtable-inventory.snapshot.json")
    if args.frontend:
        pnpm = shutil.which("pnpm")
        if not pnpm:
            raise RuntimeError("Install pnpm before building the frontend.")
        call([pnpm, "install", "--frozen-lockfile"])
        call([pnpm, "--filter", "@cloudsentinels/frontend", "build"])


if __name__ == "__main__":
    main()
