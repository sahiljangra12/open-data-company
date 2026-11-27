"""Helpers shared by the browser checks. The site is served on 8766 and the Data AI function on 8767 (see run.sh)."""
import os
import json, sys, urllib.request, re
from playwright.sync_api import sync_playwright
BASE="http://localhost:8766/"; FN="http://localhost:8767"
SHOTS=os.environ.get("SHOTS","")   # a folder to save screenshots in; none are saved when this is empty
def shot(p, name):
    if SHOTS: os.makedirs(SHOTS, exist_ok=True); p.screenshot(path=os.path.join(SHOTS, name))
def ctl(path): return urllib.request.urlopen(FN+path).read().decode()
def mlog(): return json.loads(ctl("/__log"))
res=[]
def check(name, ok, detail=""):
    res.append(bool(ok)); print(("ok   " if ok else "FAIL ")+name+((" | "+str(detail)[:230]) if detail else ""))
SR = """
window.__spoken=[];
class FakeSR{constructor(){window.__srMade=(window.__srMade||0)+1}
 start(){ if(window.__srMode==='throw') throw new Error('x'); const me=this; setTimeout(()=>{ me.onstart&&me.onstart(); const mode=window.__srMode||'ok';
   if(mode==='denied'){me.onerror({error:'not-allowed'});me.onend();return}
   if(mode==='silent'){me.onerror({error:'no-speech'});me.onend();return}
   if(mode==='hold'){window.__held=me;return}
   const text=window.__srText||'top 5 wind power', mk=t=>({results:Object.assign([Object.assign([{transcript:t}],{isFinal:true})],{length:1})});
   me.onresult(mk(text.slice(0,5))); setTimeout(()=>{me.onresult(mk(text)); setTimeout(()=>me.onend(),30)},60)},30)}
 stop(){setTimeout(()=>this.onend&&this.onend(),10)} abort(){}}
Object.defineProperty(window,'webkitSpeechRecognition',{value:FakeSR,configurable:true});Object.defineProperty(window,'SpeechRecognition',{value:FakeSR,configurable:true});
if(window.speechSynthesis){const real=window.speechSynthesis;Object.defineProperty(window,'speechSynthesis',{value:{speaking:false,speak(u){window.__spoken.push(u.text);this.speaking=true},cancel(){this.speaking=false}},configurable:true});}
"""
NOSR = "Object.defineProperty(window,'webkitSpeechRecognition',{value:undefined,configurable:true});Object.defineProperty(window,'SpeechRecognition',{value:undefined,configurable:true});"
def make(browser, ai=True, sr=SR, vp=(1280,900), dark=False):
    c=browser.new_context(viewport={"width":vp[0],"height":vp[1]}, service_workers="block")
    c.add_init_script(sr)
    if dark: c.add_init_script("try{localStorage.setItem('theme','dark')}catch(e){}")
    target = FN+"/api/data-ai" if ai else "http://localhost:8799/api/data-ai"
    def core(route):
        r=route.fetch(); body=r.text().replace('https://open-data-ai.netlify.app/api/data-ai', target); route.fulfill(response=r, body=body)
    c.route("**/assets/core.js", core)
    c.route("https://earthquake.usgs.gov/**", lambda r: r.abort())
    p=c.new_page(); errs=[]
    p.on("console", lambda m: errs.append(m.text) if m.type=="error" and "ERR_CONNECTION_REFUSED" not in m.text and "Failed to load resource" not in m.text else None)
    p.on("pageerror", lambda e: errs.append("PAGEERROR "+str(e)))
    return c,p,errs
def settled(p, n):
    """wait until a turn beyond the first n is on the page and its answer is finished"""
    p.wait_for_function("n => document.querySelectorAll('.turn').length > n && !document.querySelector('.thinking') && !document.querySelector('#ask-go').disabled && document.querySelector('#ask-go').textContent === 'Send'", arg=n, timeout=30000)
    return p.locator(".turn").last
def ask(p, q, wait_ai=False):
    n=p.locator(".turn").count(); p.fill("#q", q); p.click("#ask-go")
    return settled(p, n)

def opened(t, i=0):
    """open one folded 'Data behind this answer' and wait for its card"""
    d=t.locator("details.evidence").nth(i); d.locator("summary").click(); d.locator(".answer, .note").first.wait_for(timeout=15000); return d
