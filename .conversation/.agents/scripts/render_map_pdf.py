import fitz, os
src = "attached_assets/3_44495_Том_2_Карты-1_1791697877308.pdf"
out = ".agents/outputs/map-page-1.png"
os.makedirs(os.path.dirname(out), exist_ok=True)
doc = fitz.open(src)
print({"pages": doc.page_count, "meta": doc.metadata, "page0": tuple(doc[0].rect), "images": doc[0].get_images(full=True)[:5]})
pix = doc[0].get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False)
pix.save(out)
print(out, pix.width, pix.height)
