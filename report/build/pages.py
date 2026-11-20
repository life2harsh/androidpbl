import json, subprocess, sys, re
pdf, keys_file, out = sys.argv[1:4]
n = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", pdf], capture_output=True, text=True).stdout)[1])
texts = [" ".join(subprocess.run(["pdftotext", "-f", str(i), "-l", str(i), "-layout", pdf, "-"], capture_output=True, text=True).stdout.split()) for i in range(1, n + 1)]
start = next(i for i, t in enumerate(texts) if t.startswith("Chapter 1: Introduction"))
pages = {}
for key in json.load(open(keys_file)):
    k = " ".join(key.replace("\t", " ").split())
    for i in range(start, n):
        if k in texts[i]:
            pages[key] = i - start + 1
            break
missing = [k for k in json.load(open(keys_file)) if k not in pages]
json.dump(pages, open(out, "w"))
print(n, "pages; body starts", start + 1, "; missing:", missing)
