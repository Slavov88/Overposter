import json, sys
from pathlib import Path
import pymupdf

def check(pdf_path, config_path):
    config=json.loads(Path(config_path).read_text(encoding='utf-8'))
    if config['size']=='custom': width,height=config['widthMm'],config['heightMm']
    else:
        short,long=(841,1189) if config['size']=='A0' else (594,841)
        width,height=(long,short) if config['orientation']=='landscape' else (short,long)
    issues=[];fonts=[];images=[]
    try: doc=pymupdf.open(pdf_path)
    except Exception as exc: return {'valid':False,'pageCount':0,'widthMm':0,'heightMm':0,'issues':[{'level':'error','code':'unreadable','message':str(exc)}]}
    if doc.is_encrypted: issues.append({'level':'error','code':'encrypted','message':'PDF is encrypted.'})
    if doc.page_count!=1: issues.append({'level':'error','code':'page-count','message':f'Expected one page; found {doc.page_count}.'})
    measured_width=measured_height=0
    if doc.page_count:
        page=doc[0];measured_width=page.rect.width*25.4/72;measured_height=page.rect.height*25.4/72
        if abs(measured_width-width)>0.5 or abs(measured_height-height)>0.5: issues.append({'level':'error','code':'dimensions','message':f'Expected {width} x {height} mm; found {measured_width:.2f} x {measured_height:.2f} mm.'})
        for font in page.get_fonts(full=True):
            xref,name=font[0],font[3]
            embedded=bool(doc.extract_font(xref)[3]) if xref else False
            fonts.append({'name':name,'embedded':embedded})
            if not embedded: issues.append({'level':'warning','code':'font','message':f'Font {name} may not be embedded.'})
        for item in page.get_images(full=True):
            xref=item[0];pix_width,pix_height=item[2],item[3]
            for rect in page.get_image_rects(xref):
                if rect.width<=0 or rect.height<=0: continue
                dpi_x=pix_width*72/rect.width;dpi_y=pix_height*72/rect.height;dpi=min(dpi_x,dpi_y)
                images.append({'xref':xref,'effectiveDpi':round(dpi,1)})
                if dpi<150:issues.append({'level':'warning','code':'low-dpi','message':f'Image {xref} has about {dpi:.0f} effective DPI (recommended at least 150).'})
        # Text outside the media box is a useful hint, but not a complete clipping test.
        for block in page.get_text('dict').get('blocks',[]):
            if block.get('type')==0:
                box=pymupdf.Rect(block['bbox'])
                if not page.rect.intersects(box):issues.append({'level':'warning','code':'off-page-text','message':'Some text lies outside the poster page.'});break
    if not Path(pdf_path).read_bytes().rstrip().endswith(b'%%EOF'):issues.append({'level':'error','code':'trailer','message':'PDF trailer is missing.'})
    return {'valid':not any(i['level']=='error' for i in issues),'pageCount':doc.page_count,'widthMm':round(measured_width,2),'heightMm':round(measured_height,2),'issues':issues,'fonts':fonts,'images':images}

if __name__=='__main__':print(json.dumps(check(sys.argv[1],sys.argv[2])))
