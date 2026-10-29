import sys,subprocess,pathlib,shutil
from playwright.sync_api import sync_playwright
import os
R=pathlib.Path('/workspace/brand/quiver/final/hero' if os.environ.get('FINAL')=='1' else '/workspace/brand/quiver/hero'); fr=pathlib.Path('/tmp/qframes'); 
mode=sys.argv[1]
with sync_playwright() as p:
    b=p.chromium.launch(executable_path='/usr/bin/google-chrome')
    sc=2 if mode=='still' else 4/3
    pg=b.new_context(viewport={'width':1440,'height':900},device_scale_factor=sc).new_page()
    pg.add_init_script('window.__manual=true'); pg.goto((R/'hero.html').as_uri()); pg.evaluate('document.fonts.ready'); pg.wait_for_timeout(300)
    if mode=='still':
        pg.evaluate('__seek(2500)'); pg.screenshot(path=str(R/'hero-2880x1800.png'))
    else:
        shutil.rmtree(fr,ignore_errors=True); fr.mkdir()
        fps=60; n=6*fps
        for i in range(n):
            pg.evaluate(f'__seek({i*1000/fps})'); pg.screenshot(path=str(fr/f'{i:04d}.png'),type='png')
    b.close()
if mode!='still':
    subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate','60','-i',str(fr/'%04d.png'),'-c:v','libx264','-preset','slow','-crf','14','-pix_fmt','yuv420p','-movflags','+faststart',str(R/'hero-loop-1920x1200-60fps.mp4')],check=True)
    subprocess.run(['ffmpeg','-y','-loglevel','error','-framerate','60','-i',str(fr/'%04d.png'),'-c:v','libvpx-vp9','-b:v','0','-crf','24','-row-mt','1','-pix_fmt','yuv420p',str(R/'hero-loop-1920x1200-60fps.webm')],check=True)
