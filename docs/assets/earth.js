/* The Earth as it is right now: NASA Blue Marble on the day side, city lights on the night side,
   with the line between them where the sun actually puts it at this minute. Drawn by one small WebGL shader.
   makeEarth(canvas) returns { ready, draw(size, radius, rot, tilt) }; ready stays false if WebGL or the photos are unavailable. */

/* Where the sun is overhead at time t (ms): { lat, lon } in degrees. NOAA's low-accuracy solar position formulas. */
function sunNow(t = Date.now()) {
  const d = new Date(t), doy = Math.floor((t - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5);
  const hr = d.getUTCHours() + d.getUTCMinutes() / 60 + d.getUTCSeconds() / 3600, g = 2 * Math.PI / 365 * (doy + (hr - 12) / 24);
  const eq = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));   // equation of time, minutes
  const dec = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const lon = ((-15 * (hr - 12 + eq / 60) + 540) % 360) - 180;
  return { lat: dec * 180 / Math.PI, lon };
}

function makeEarth(cv) {
  const api = { ready: false, draw() {} };
  let gl;
  try { gl = cv.getContext("webgl", { alpha: true, antialias: false, premultipliedAlpha: true, powerPreference: "low-power" }); } catch (e) { gl = null; }
  if (!gl) return api;
  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `precision highp float;
uniform sampler2D day,night;uniform vec2 res;uniform float rad,ca,sa,ct,st;uniform vec3 sun;
vec3 earth(vec3 v){float y=v.y*ct+v.z*st,z1=-v.y*st+v.z*ct;return vec3(v.x*ca-z1*sa,y,v.x*sa+z1*ca);}   // screen direction -> direction on the Earth
vec4 air(vec2 p,float r){float a=clamp(1.-(r-1.)/.13,0.,1.);float lit=smoothstep(-.45,.5,dot(earth(vec3(p/r,0.)),sun));float g=a*a*a*(.16+.5*lit);return vec4(vec3(.36,.62,1.)*g,g);}
void main(){
  vec2 p=(gl_FragCoord.xy-.5*res)/rad;float r=length(p);
  if(r>1.){gl_FragColor=air(p,r);return;}
  float z=sqrt(1.-r*r);vec3 e=earth(vec3(p,z));
  vec2 uv=vec2(atan(e.x,e.z)/6.2831853+.5,.5-asin(clamp(e.y,-1.,1.))/3.14159265);
  vec3 d=texture2D(day,uv).rgb,n=texture2D(night,uv).rgb;
  float lamp=max(n.r-n.b*.92,0.);                                  // warm pixels are city lights; the land itself is blue
  vec3 dark=n*vec3(.75,.85,1.)*.9+pow(lamp,.8)*vec3(4.2,3.1,1.5);
  float s=dot(e,sun),k=smoothstep(-.1,.16,s);
  vec3 c=mix(dark,d*(.86+.26*max(s,0.)),k);
  c=mix(c,vec3(.45,.68,1.),pow(1.-z,2.6)*(.14+.5*k));              // haze toward the limb
  float aa=clamp((1.-r)*rad,0.,1.);vec4 o=air(p,1.);
  gl_FragColor=vec4(mix(o.rgb,c,aa),mix(o.a,1.,aa));
}`;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = sh(gl.VERTEX_SHADER, VS), fs = sh(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return api;
  const pr = gl.createProgram(); gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
  if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) return api;
  gl.useProgram(pr);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(pr, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {}; ["day", "night", "res", "rad", "ca", "sa", "ct", "st", "sun"].forEach(n => U[n] = gl.getUniformLocation(pr, n));
  gl.uniform1i(U.day, 0); gl.uniform1i(U.night, 1);
  const tex = [gl.createTexture(), gl.createTexture()], have = [false, false];
  const put = (unit, img) => {
    gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, tex[unit]);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    have[unit] = true; api.ready = have[0] && have[1] && !lost; if (api.ready && api.onready) api.onready();
  };
  const fetchImg = (unit, src) => { const im = new Image(); im.onload = () => { try { put(unit, im); } catch (e) { api.ready = false; } }; im.src = src; };
  let lost = false, sharp = false;
  cv.addEventListener("webglcontextlost", e => { e.preventDefault(); lost = true; api.ready = false; });
  fetchImg(0, "img/earth-day-2k.jpg"); fetchImg(1, "img/earth-night-2k.jpg");

  api.draw = (size, radius, rot, tilt) => {
    if (!api.ready) return;
    if (!sharp && size >= 1100 && gl.getParameter(gl.MAX_TEXTURE_SIZE) >= 4096) { sharp = true; fetchImg(0, "img/earth-day-4k.jpg"); fetchImg(1, "img/earth-night-4k.jpg"); }   // large screens get the sharper photos once the first ones are showing
    gl.viewport(0, 0, size, size);
    const s = sunNow(), R = Math.PI / 180;
    gl.uniform2f(U.res, size, size); gl.uniform1f(U.rad, radius);
    gl.uniform1f(U.ca, Math.cos(rot)); gl.uniform1f(U.sa, Math.sin(rot)); gl.uniform1f(U.ct, Math.cos(tilt)); gl.uniform1f(U.st, Math.sin(tilt));
    gl.uniform3f(U.sun, Math.cos(s.lat * R) * Math.sin(s.lon * R), Math.sin(s.lat * R), Math.cos(s.lat * R) * Math.cos(s.lon * R));
    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
  return api;
}
