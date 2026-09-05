import re, sys, subprocess, tempfile, os, shutil

# 跨平台语法校验：抽取 HTML 内联 <script>（不含 src 外链）跑 node --check
# 用法：python3 verify_nfo.py [path/to/nfo-editor-ios.html]
html_path = sys.argv[1] if len(sys.argv) > 1 else "nfo-editor-ios.html"
with open(html_path, "r", encoding="utf-8") as f:
    html = f.read()

html_nc = re.sub(r"<!--.*?-->", "", html, flags=re.S)
scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html_nc, flags=re.S)
js = "\n".join(scripts)

fd, out_js = tempfile.mkstemp(suffix=".js", prefix="nfo_verify_")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        f.write(js)
    # node 路径：优先环境变量 NODE_BIN，其次 PATH 中的 node，最后回退 Windows 旧路径
    node = os.environ.get("NODE_BIN") or shutil.which("node") or r"C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe"
    r = subprocess.run([node, "--check", out_js], capture_output=True, text=True)
    print("=== node --check ===")
    print("returncode:", r.returncode)
    print(r.stdout)
    print(r.stderr)
    print("=== script blocks:", len(scripts), "js bytes:", len(js.encode("utf-8")), "===")
    sys.exit(r.returncode)
finally:
    try:
        os.remove(out_js)
    except OSError:
        pass
