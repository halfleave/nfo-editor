import re, sys, subprocess

html_path = sys.argv[1] if len(sys.argv) > 1 else r"C:/Users/Administrator/Desktop/work/NFO/nfo-editor-ios.html"
with open(html_path, "r", encoding="utf-8") as f:
    html = f.read()

html_nc = re.sub(r"<!--.*?-->", "", html, flags=re.S)
scripts = re.findall(r"<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>", html_nc, flags=re.S)
js = "\n".join(scripts)

out_js = r"C:/Users/Administrator/Desktop/work/NFO/_verify_tmp.js"
with open(out_js, "w", encoding="utf-8") as f:
    f.write(js)

node = r"C:/Users/Administrator/.workbuddy/binaries/node/versions/22.22.2/node.exe"
r = subprocess.run([node, "--check", out_js], capture_output=True, text=True)
print("=== node --check ===")
print("returncode:", r.returncode)
print(r.stdout)
print(r.stderr)
print("=== script blocks:", len(scripts), "js bytes:", len(js.encode("utf-8")), "===")
sys.exit(r.returncode)
