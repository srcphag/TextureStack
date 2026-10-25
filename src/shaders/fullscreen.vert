#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  // Fullscreen triangle covering [-1, 1] clip space with UV in [0, 1]
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  vUv = p;
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
