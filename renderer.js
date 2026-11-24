const FULLSCREEN_VERT = `#version 300 es
in vec2 aPos;
out vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

// 9-tap separable Gaussian blur with channel selection (0=R macro, 1=G micro, 2=max(R,G) shadow)
const BLUR_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uTex;
uniform vec2 uTexelSize;
uniform vec2 uDir;
uniform float uRadius;
uniform int uMode;

float sampleVal(vec2 uv) {
  vec4 c = texture(uTex, clamp(uv, vec2(0.0), vec2(1.0)));
  if (uMode == 0) return c.r;
  if (uMode == 1) return c.g;
  return max(c.r, c.g);
}

void main() {
  vec2 stepUv = uDir * uTexelSize * uRadius;
  float sum = 0.0;
  sum += sampleVal(vUv - 4.0 * stepUv) * 0.0162;
  sum += sampleVal(vUv - 3.0 * stepUv) * 0.0540;
  sum += sampleVal(vUv - 2.0 * stepUv) * 0.1216;
  sum += sampleVal(vUv - 1.0 * stepUv) * 0.1945;
  sum += sampleVal(vUv)                * 0.2270;
  sum += sampleVal(vUv + 1.0 * stepUv) * 0.1945;
  sum += sampleVal(vUv + 2.0 * stepUv) * 0.1216;
  sum += sampleVal(vUv + 3.0 * stepUv) * 0.0540;
  sum += sampleVal(vUv + 4.0 * stepUv) * 0.0162;
  fragColor = vec4(sum, sum, sum, 1.0);
}
`;

// Final 3D Glossy Black Ink Height-Field + Specular + Drop Shadow Pass
const COMPOSITE_FRAG = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uMacro;
uniform sampler2D uMicro;
uniform sampler2D uShadow;
uniform vec2 uResolution;
uniform float uGlossiness;

float smax(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(a, b, h) + k * h * (1.0 - h);
}

float heightAt(vec2 uv) {
  float macro = texture(uMacro, uv).r;
  float micro = texture(uMicro, uv).r;
  float hMacro = pow(smoothstep(0.36, 0.96, macro), 0.54);
  float hMicro = pow(smoothstep(0.16, 0.88, micro), 0.52) * 0.54;
  return smax(hMacro, hMicro, 0.20);
}

void main() {
  float macro = texture(uMacro, vUv).r;
  float micro = texture(uMicro, vUv).r;

  float macroMask = smoothstep(0.45, 0.525, macro);
  float microMask = smoothstep(0.28, 0.48, micro);
  float inkAlpha = clamp(max(macroMask, microMask), 0.0, 1.0);

  // Soft drop shadow offset down (+11px) and slightly right (+3px) in screen space.
  // With UNPACK_FLIP_Y_WEBGL=true, screen-down is -Y in UV, so we sample at +11px UV.y and -3px UV.x.
  vec2 shadowUv = vUv + vec2(-3.0, 11.0) / uResolution;
  float shadowSample = texture(uShadow, clamp(shadowUv, vec2(0.0), vec2(1.0))).r;
  float shadowAlpha = smoothstep(0.005, 0.85, shadowSample) * 0.24;
  vec3 shadowCol = vec3(0.02, 0.024, 0.045);

  vec3 inkCol = vec3(0.0);
  if (inkAlpha > 0.002) {
    vec2 stepUv = 2.0 / uResolution;
    float hL = heightAt(vUv - vec2(stepUv.x, 0.0));
    float hR = heightAt(vUv + vec2(stepUv.x, 0.0));
    float hD = heightAt(vUv - vec2(0.0, stepUv.y));
    float hU = heightAt(vUv + vec2(0.0, stepUv.y));

    vec3 N = normalize(vec3((hL - hR) * 2.4, (hD - hU) * 2.4, 0.24));
    vec3 V = vec3(0.0, 0.0, 1.0);

    // Key studio softbox from top-left-front
    vec3 L1 = normalize(vec3(-0.36, 0.74, 0.56));
    vec3 H1 = normalize(L1 + V);
    float ndoth1 = max(dot(N, H1), 0.0);

    // Broad soft sheen + rounded studio rim band
    float broadSheen = pow(ndoth1, 14.0) * 0.28;
    float crispBand = smoothstep(0.905, 0.985, ndoth1) * 0.68 + pow(ndoth1, 110.0) * 0.35;
    float keySpec = (broadSheen + crispBand) * uGlossiness;

    // Secondary subtle fill from top-right
    vec3 L2 = normalize(vec3(0.55, 0.62, 0.56));
    vec3 H2 = normalize(L2 + V);
    float spec2 = pow(max(dot(N, H2), 0.0), 48.0) * 0.14 * uGlossiness;

    // Bottom bounce reflection from the off-white stage surface
    vec3 L3 = normalize(vec3(0.10, -0.88, 0.46));
    float bounce = pow(max(dot(N, L3), 0.0), 3.0) * 0.14;
    float bottomEdge = smoothstep(0.35, 0.85, -N.y) * 0.09;

    // Fresnel rim polish
    float fresnel = pow(1.0 - max(dot(N, V), 0.0), 4.0) * 0.10;

    vec3 baseBlack = vec3(0.022, 0.024, 0.030);
    inkCol = baseBlack
      + vec3(0.98, 0.99, 1.0) * (keySpec + spec2)
      + vec3(0.82, 0.85, 0.90) * (bounce + bottomEdge + fresnel);
    inkCol = clamp(inkCol, 0.0, 1.0);
  }

  // Output true premultiplied RGBA matching context { premultipliedAlpha: true }
  float outAlpha = inkAlpha + shadowAlpha * (1.0 - inkAlpha);
  vec3 outPremul = inkCol * inkAlpha + shadowCol * shadowAlpha * (1.0 - inkAlpha);
  fragColor = vec4(outPremul, outAlpha);
}
`;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile error: ${info}`);
  }
  return shader;
}

function createProgram(gl, vertSrc, fragSrc) {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(prog);
    gl.deleteProgram(prog);
    throw new Error(`Program link error: ${info}`);
  }
  return prog;
}

function createRenderTarget(gl, width, height) {
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);

  return { tex, fbo, width, height };
}

function destroyRenderTarget(gl, rt) {
  if (!rt) return;
  gl.deleteFramebuffer(rt.fbo);
  gl.deleteTexture(rt.tex);
}

/**
 * Resamples a strand's Verlet chain with Catmull-Rom interpolation for silky-smooth curves.
 */
function sampleSmoothSpline(nodes, steps = 20) {
  const n = nodes.length;
  if (n < 2) return nodes;
  const out = [];
  for (let s = 0; s <= steps; s++) {
    const u = (s / steps) * (n - 1);
    const i1 = Math.min(Math.floor(u), n - 2);
    const t = u - i1;
    const p0 = nodes[Math.max(0, i1 - 1)];
    const p1 = nodes[i1];
    const p2 = nodes[i1 + 1];
    const p3 = nodes[Math.min(n - 1, i1 + 2)];

    const t2 = t * t;
    const t3 = t2 * t;
    const x =
      0.5 *
      (2 * p1.x +
        (-p0.x + p2.x) * t +
        (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2 +
        (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3);
    const y =
      0.5 *
      (2 * p1.y +
        (-p0.y + p2.y) * t +
        (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2 +
        (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3);
    out.push({ x, y });
  }
  return out;
}

function drawTaperedRibbon(ctx, pts, widthFn, capEnd = false) {
  const m = pts.length;
  if (m < 2) return;
  const left = new Array(m);
  const right = new Array(m);

  for (let i = 0; i < m; i++) {
    const prev = pts[Math.max(0, i - 1)];
    const next = pts[Math.min(m - 1, i + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const hw = widthFn(i / (m - 1)) * 0.5;
    left[i] = { x: pts[i].x + nx * hw, y: pts[i].y + ny * hw };
    right[i] = { x: pts[i].x - nx * hw, y: pts[i].y - ny * hw };
  }

  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < m; i++) {
    ctx.lineTo(left[i].x, left[i].y);
  }
  for (let i = m - 1; i >= 0; i--) {
    ctx.lineTo(right[i].x, right[i].y);
  }
  ctx.closePath();
  ctx.fill();

  if (capEnd) {
    const end = pts[m - 1];
    const r = Math.max(1.2, widthFn(1) * 0.65);
    ctx.beginPath();
    ctx.arc(end.x, end.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
}

export class StickyInkRenderer {
  constructor(canvas, physics) {
    this.canvas = canvas;
    this.physics = physics;
    this.width = 1080;
    this.height = 640;
    this.dpr = 1;
    this.shapeScale = 1;

    this.shapeCanvas = document.createElement('canvas');
    this.shapeCtx = this.shapeCanvas.getContext('2d', { alpha: true });

    this.gl = null;
    this.isWebGL2 = false;
    this._initWebGL();
  }

  _initWebGL() {
    const gl = this.canvas.getContext('webgl2', {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
    });
    if (!gl) {
      this.isWebGL2 = false;
      return;
    }

    try {
      this.gl = gl;
      this.progBlur = createProgram(gl, FULLSCREEN_VERT, BLUR_FRAG);
      this.progComposite = createProgram(gl, FULLSCREEN_VERT, COMPOSITE_FRAG);

      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      const quadBuf = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

      const posLocBlur = gl.getAttribLocation(this.progBlur, 'aPos');
      gl.enableVertexAttribArray(posLocBlur);
      gl.vertexAttribPointer(posLocBlur, 2, gl.FLOAT, false, 0, 0);

      this.texShape = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.texShape);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

      this.uBlur = {
        tex: gl.getUniformLocation(this.progBlur, 'uTex'),
        texelSize: gl.getUniformLocation(this.progBlur, 'uTexelSize'),
        dir: gl.getUniformLocation(this.progBlur, 'uDir'),
        radius: gl.getUniformLocation(this.progBlur, 'uRadius'),
        mode: gl.getUniformLocation(this.progBlur, 'uMode'),
      };
      this.uComp = {
        macro: gl.getUniformLocation(this.progComposite, 'uMacro'),
        micro: gl.getUniformLocation(this.progComposite, 'uMicro'),
        shadow: gl.getUniformLocation(this.progComposite, 'uShadow'),
        res: gl.getUniformLocation(this.progComposite, 'uResolution'),
        gloss: gl.getUniformLocation(this.progComposite, 'uGlossiness'),
      };

      this.isWebGL2 = true;
    } catch (err) {
      console.warn('WebGL2 initialization failed, using fallback:', err);
      this.isWebGL2 = false;
      this.gl = null;
    }
  }

  resize(width, height, dpr = window.devicePixelRatio || 1) {
    if (width <= 0 || height <= 0) return;
    this.width = width;
    this.height = height;
    this.dpr = Math.min(dpr, 2);
    this.shapeScale = Math.min(dpr, 1.5);

    const cw = Math.max(1, Math.round(width * this.shapeScale));
    const ch = Math.max(1, Math.round(height * this.shapeScale));

    this.shapeCanvas.width = cw;
    this.shapeCanvas.height = ch;

    if (!this.isWebGL2 || !this.gl) {
      this.canvas.width = cw;
      this.canvas.height = ch;
      return;
    }

    const gl = this.gl;
    this.canvas.width = Math.max(1, Math.round(width * this.dpr));
    this.canvas.height = Math.max(1, Math.round(height * this.dpr));

    destroyRenderTarget(gl, this.rtMacroTmp);
    destroyRenderTarget(gl, this.rtMacro);
    destroyRenderTarget(gl, this.rtMicroTmp);
    destroyRenderTarget(gl, this.rtMicro);
    destroyRenderTarget(gl, this.rtShadowTmp);
    destroyRenderTarget(gl, this.rtShadow);

    this.rtMacroTmp = createRenderTarget(gl, cw, ch);
    this.rtMacro = createRenderTarget(gl, cw, ch);
    this.rtMicroTmp = createRenderTarget(gl, cw, ch);
    this.rtMicro = createRenderTarget(gl, cw, ch);

    const sw = Math.max(1, Math.round(cw * 0.5));
    const sh = Math.max(1, Math.round(ch * 0.5));
    this.rtShadowTmp = createRenderTarget(gl, sw, sh);
    this.rtShadow = createRenderTarget(gl, sw, sh);
  }

  _rasterizeDualChannels() {
    const ctx = this.shapeCtx;
    const sc = this.shapeScale;
    const phys = this.physics;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.shapeCanvas.width, this.shapeCanvas.height);
    ctx.setTransform(sc, 0, 0, sc, 0, 0);
    ctx.globalCompositeOperation = 'lighter';

    const rimPts = phys.getDeformedRimPoints();

    // =========================================================================
    // RED CHANNEL: Macro Metaball Layer (pill body, root meniscus necks, cursor blobs)
    // =========================================================================
    ctx.fillStyle = '#ff0000';

    // Closed smooth curve through 64 deformed rim nodes
    ctx.beginPath();
    const len = rimPts.length;
    const firstMidX = (rimPts[len - 1].x + rimPts[0].x) * 0.5;
    const firstMidY = (rimPts[len - 1].y + rimPts[0].y) * 0.5;
    ctx.moveTo(firstMidX, firstMidY);
    for (let i = 0; i < len; i++) {
      const curr = rimPts[i];
      const next = rimPts[(i + 1) % len];
      const mx = (curr.x + next.x) * 0.5;
      const my = (curr.y + next.y) * 0.5;
      ctx.quadraticCurveTo(curr.x, curr.y, mx, my);
    }
    ctx.closePath();
    ctx.fill();

    // Smooth meniscus necks at the roots of attached strands (first ~28%)
    for (const strand of phys.strands) {
      const smoothPts = sampleSmoothSpline(strand.nodes, 16);
      if (strand.state === 'attached') {
        const rootPts = smoothPts.slice(0, 5);
        const rootBase = strand.role === 'primary' ? 15 : 10;
        drawTaperedRibbon(
          ctx,
          rootPts,
          (t) => rootBase * Math.pow(1 - t, 1.55) + (strand.role === 'primary' ? 3.2 : 1.8),
          false
        );

        // Small cursor-end attachment flare in macro layer for primary strands
        if (strand.role === 'primary' && phys.cursorStain > 0.1) {
          const endPts = smoothPts.slice(12);
          drawTaperedRibbon(
            ctx,
            endPts,
            (t) => 2.4 + t * 4.2 * phys.cursorStain,
            true
          );
        }
      } else {
        // Retracting base flare
        const rootPts = smoothPts.slice(0, 4);
        drawTaperedRibbon(
          ctx,
          rootPts,
          (t) => 9 * (1 - strand.retractT * 0.7) * (1 - t * 0.85),
          false
        );
      }
    }

    // Cursor goo blobs coating the hand cursor
    if (phys.cursorStain > 0.04) {
      for (const blob of phys.cursorBlobs) {
        const r = blob.baseR * (0.42 + 0.68 * phys.cursorStain);
        ctx.beginPath();
        ctx.arc(blob.x, blob.y, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Droplets >= 1.7px also enter macro channel for smooth 3D specular domes
    for (const d of phys.droplets) {
      if (d.radius >= 1.7) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.radius * 1.05, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Rounded splash lobes in macro channel for smooth root fusion
    for (const sp of phys.spikes) {
      const t = sp.age / sp.life;
      const len = sp.length * Math.sin(t * Math.PI);
      if (len < 1) continue;
      const lobePts = [
        { x: sp.x, y: sp.y },
        { x: sp.x + sp.dx * len * 0.5, y: sp.y + sp.dy * len * 0.5 },
        { x: sp.x + sp.dx * len, y: sp.y + sp.dy * len },
      ];
      drawTaperedRibbon(ctx, lobePts, (u) => sp.width * (1.2 - u * 0.85) * (1 - t * 0.4), true);
    }

    // =========================================================================
    // GREEN CHANNEL: Micro Filament & Crisp Droplet Layer (thin strands + lobes)
    // =========================================================================
    ctx.fillStyle = '#00ff00';

    for (const strand of phys.strands) {
      const smoothPts = sampleSmoothSpline(strand.nodes, 20);
      if (strand.state === 'attached') {
        const thinFactor = clampNum(1 / (0.65 + strand.stretchRatio * 1.45), 0.28, 1.0);
        const minMid = strand.baseWidth * thinFactor;
        drawTaperedRibbon(
          ctx,
          smoothPts,
          (t) => {
            const rootFlare = Math.pow(1 - t, 3.0) * (strand.baseWidth * 0.95);
            const tipFlare = Math.pow(t, 2.5) * (strand.role === 'primary' ? 2.6 : 1.6);
            return minMid + rootFlare + tipFlare;
          },
          true
        );
      } else {
        // Retracting whip with rounded teardrop tip
        const fade = clampNum(1 - strand.retractT * 0.35, 0.4, 1);
        drawTaperedRibbon(
          ctx,
          smoothPts,
          (t) => {
            const w = strand.baseWidth * 0.7 * fade * (1 - t * 0.45);
            const tipBead = Math.exp(-Math.pow((t - 0.92) * 8, 2)) * 2.8 * fade;
            return Math.max(1.2, w + tipBead);
          },
          true
        );
      }
    }

    // All droplets rendered crisp in micro layer
    for (const d of phys.droplets) {
      if (d.radius > 0.35) {
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Rounded splash recoil lobes on pill edge
    for (const sp of phys.spikes) {
      const t = sp.age / sp.life;
      const len = sp.length * Math.sin(t * Math.PI);
      if (len < 1) continue;
      const lobePts = [
        { x: sp.x, y: sp.y },
        { x: sp.x + sp.dx * len * 0.5, y: sp.y + sp.dy * len * 0.5 },
        { x: sp.x + sp.dx * len, y: sp.y + sp.dy * len },
      ];
      drawTaperedRibbon(ctx, lobePts, (u) => sp.width * (1.0 - u * 0.75) * (1 - t * 0.4), true);
    }
  }

  _runBlurPass(srcTex, dstRt, dirX, dirY, radius, mode) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, dstRt.fbo);
    gl.viewport(0, 0, dstRt.width, dstRt.height);
    gl.useProgram(this.progBlur);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, srcTex);
    gl.uniform1i(this.uBlur.tex, 0);
    gl.uniform2f(this.uBlur.texelSize, 1 / dstRt.width, 1 / dstRt.height);
    gl.uniform2f(this.uBlur.dir, dirX, dirY);
    gl.uniform1f(this.uBlur.radius, radius);
    gl.uniform1i(this.uBlur.mode, mode);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render() {
    this._rasterizeDualChannels();

    if (!this.isWebGL2 || !this.gl) {
      this._renderFallback2D();
      return;
    }

    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.disable(gl.BLEND);

    // Upload dual-channel shape mask with Y-flip so UV.y points up in screen space
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texShape);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.shapeCanvas);

    // 1-2: Macro metaball blur (R channel, ~10px radius in shapeCanvas pixels)
    const macroRadius = 2.75 * this.shapeScale;
    this._runBlurPass(this.texShape, this.rtMacroTmp, 1, 0, macroRadius, 0);
    this._runBlurPass(this.rtMacroTmp.tex, this.rtMacro, 0, 1, macroRadius, 0);

    // 3-4: Micro filament anti-alias & dome blur (G channel, smooth cylindrical profile)
    const microRadius = 0.82 * this.shapeScale;
    this._runBlurPass(this.texShape, this.rtMicroTmp, 1, 0, microRadius, 1);
    this._runBlurPass(this.rtMicroTmp.tex, this.rtMicro, 0, 1, microRadius, 0);

    // 5-6: Wide soft shadow blur (half-res, max(R, G))
    const shadowRadius = 2.5 * this.shapeScale;
    this._runBlurPass(this.texShape, this.rtShadowTmp, 1, 0, shadowRadius, 2);
    this._runBlurPass(this.rtShadowTmp.tex, this.rtShadow, 0, 1, shadowRadius, 0);

    // 7: Final 3D glossy black ink composite to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.progComposite);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.rtMacro.tex);
    gl.uniform1i(this.uComp.macro, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.rtMicro.tex);
    gl.uniform1i(this.uComp.micro, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.rtShadow.tex);
    gl.uniform1i(this.uComp.shadow, 2);

    gl.uniform2f(this.uComp.res, this.width, this.height);
    gl.uniform1f(this.uComp.gloss, this.physics.config.glossiness);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  _renderFallback2D() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.save();
    ctx.drawImage(this.shapeCanvas, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = '#0a0a0d';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.restore();
  }
}

function clampNum(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
