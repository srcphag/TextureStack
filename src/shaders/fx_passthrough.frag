#version 300 es
// ============================================================
// Texture Stack — FX Stage Pass (D5)
// Real post-processing pass reading the intermediate FBO texture.
// Pass-through in v1, always outputting opaque alpha = 1.0 (D13).
// Flips vUv.y so top-down texture coordinates (row 0 = top) map to
// top of the WebGL screen viewport (gl_Position.y = +1).
// ============================================================
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uScene;

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec4 sceneColor = texture(uScene, uv);
  fragColor = vec4(sceneColor.rgb, 1.0);
}
