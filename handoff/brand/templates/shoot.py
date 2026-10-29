from playwright.sync_api import sync_playwright
import pathlib
CH='/usr/bin/google-chrome'
def shoot(jobs):
    """(src html/svg, w, h, scale, out, transparent)"""
    with sync_playwright() as p:
        b=p.chromium.launch(executable_path=CH)
        for src,w,h,sc,out,tr in jobs:
            ctx=b.new_context(viewport={'width':w,'height':h},device_scale_factor=sc); pg=ctx.new_page()
            src=pathlib.Path(src).resolve()
            if src.suffix=='.svg':
                tmp=pathlib.Path('/tmp/_wrap.html'); tmp.write_text(f'<html><body style="margin:0;background:transparent"><img src="{src.as_uri()}" style="width:{w}px;height:{h}px;display:block"></body></html>'); src=tmp
            pg.goto(src.as_uri()); pg.wait_for_load_state('networkidle'); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(200)
            pathlib.Path(out).parent.mkdir(parents=True,exist_ok=True)
            pg.screenshot(path=str(out),omit_background=tr,clip={'x':0,'y':0,'width':w,'height':h}); ctx.close()
        b.close()
