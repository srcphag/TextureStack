// ============================================================
// Image Stack Selector (GLSL Multi TOP)
//
// N images are stacked/layered onto one canvas. A single-channel
// control texture (normalized 0-1) picks which layer is visible
// at each pixel. Optionally crossfades smoothly between the two
// nearest layers instead of hard-cutting.
//
// Input wiring:
//   input 0             -> control map (R = normalized layer selector, 0-1)
//   input 1 .. input N  -> your N stacked images
//
// Set Nearest filtering on the control map if uSmoothBlend = 0.0
// (linear filtering would blur index boundaries into meaningless
// intermediate values). If uSmoothBlend = 1.0, Linear filtering on
// the control map is fine and even desirable for smooth scrubbing.
// ============================================================
// uniform float exampleUniform;
out vec4 fragColor;

uniform float uNumImages;        // how many images are stacked (inputs 1..N)
uniform int   uImageInputOffset; // = 1  (control map occupies slot 0)
uniform float uSmoothBlend;      // 0.0 = hard switch, 1.0 = crossfade between neighbors
uniform vec2  uFitSize;          // (0,0) = no fit correction, otherwise per-image aspect fit -- see note below

int clampIndex(int idx)
{
	return clamp(idx, 0, int(uNumImages) - 1);
}

void main()
{
	vec2 uv = vUV.st;

	float control = texture(sTD2DInputs[0], uv).r; // normalized 0-1
	float scaled  = clamp(control, 0.0, 1.0) * (uNumImages - 1.0);

	if (uSmoothBlend < 0.5)
	{
		// --- hard switch: nearest layer only ---
		int idx  = clampIndex(int(floor(scaled + 0.5)));
		int slot = idx + uImageInputOffset;
		vec4 color = texture(sTD2DInputs[slot], uv);
		fragColor = TDOutputSwizzle(color);
	}
	else
	{
		// --- smooth crossfade between the two straddling layers ---
		int idxA = clampIndex(int(floor(scaled)));
		int idxB = clampIndex(idxA + 1);
		float t  = fract(scaled);

		int slotA = idxA + uImageInputOffset;
		int slotB = idxB + uImageInputOffset;

		vec4 colorA = texture(sTD2DInputs[slotA], uv);
		vec4 colorB = texture(sTD2DInputs[slotB], uv);

		fragColor = TDOutputSwizzle(mix(colorA, colorB, t));
	}
}