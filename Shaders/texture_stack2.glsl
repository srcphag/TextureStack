// ============================================================
// Image Stack Selector with Mask + Luminance Offset (GLSL Multi TOP)
//
// Input wiring:
//   input 0              -> control map
//   input 1              -> mask (R channel)
//                           white = show stacked textures
//                           black = show original control image
//   input 2 .. input N+1 -> your N stacked images
//
// uImageInputOffset must be 2.
// ============================================================
out vec4 fragColor;

uniform float uNumImages;        // how many images are stacked
uniform int   uImageInputOffset; // = 2
uniform float uSmoothBlend;      // 0.0 = hard switch, 1.0 = crossfade
uniform float uMaskInfluence;    // 0.0 = mask ignored, 1.0 = mask fully applied
uniform float uInvertMask;       // 0.0 = normal, 1.0 = flip mask
uniform float uMaskMin;          // 0-1, mask values at or below this become 0
uniform float uMaskMax;          // 0-1, mask values at or above this become 1
uniform float uContrast;         // 1.0 = unchanged, >1 = more contrast, <1 = flatter, 0 = flat grey
uniform float uOffset;           // 0-1, added to control luminance (animate this)
uniform float uCyclic;           // 1.0 = offset wraps and loops, 0.0 = clamps

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

void main()
{
	vec2 uv = vUV.st;
	int  n  = int(uNumImages);

	vec4  controlColor = texture(sTD2DInputs[0], uv);

	// contrast around mid-grey, applied before the luminance lookup
	vec3 contrasted = clamp((controlColor.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);
	float lum       = dot(contrasted, LUMA);

	// --- stacked texture result ---
	vec4 stacked;

	if (uCyclic > 0.5)
	{
		float scaled = fract(lum + uOffset) * uNumImages;

		if (uSmoothBlend < 0.5)
		{
			int idx = int(floor(scaled)) % n;
			stacked = texture(sTD2DInputs[idx + uImageInputOffset], uv);
		}
		else
		{
			int idxA = int(floor(scaled)) % n;
			int idxB = (idxA + 1) % n;
			float t  = fract(scaled);
			vec4 colorA = texture(sTD2DInputs[idxA + uImageInputOffset], uv);
			vec4 colorB = texture(sTD2DInputs[idxB + uImageInputOffset], uv);
			stacked = mix(colorA, colorB, t);
		}
	}
	else
	{
		float scaled = clamp(lum + uOffset, 0.0, 1.0) * (uNumImages - 1.0);

		if (uSmoothBlend < 0.5)
		{
			int idx = clamp(int(floor(scaled + 0.5)), 0, n - 1);
			stacked = texture(sTD2DInputs[idx + uImageInputOffset], uv);
		}
		else
		{
			int idxA = clamp(int(floor(scaled)), 0, n - 1);
			int idxB = clamp(idxA + 1, 0, n - 1);
			float t  = fract(scaled);
			vec4 colorA = texture(sTD2DInputs[idxA + uImageInputOffset], uv);
			vec4 colorB = texture(sTD2DInputs[idxB + uImageInputOffset], uv);
			stacked = mix(colorA, colorB, t);
		}
	}

	// --- mask ---
	float mask = texture(sTD2DInputs[1], uv).r;

	// clamp from bottom and top, then stretch the remaining range to 0-1
	float lo = min(uMaskMin, uMaskMax);
	float hi = max(uMaskMin, uMaskMax);
	mask = clamp((mask - lo) / max(hi - lo, 1e-5), 0.0, 1.0);

	mask = mix(mask, 1.0 - mask, step(0.5, uInvertMask));
	float m = mix(1.0, mask, clamp(uMaskInfluence, 0.0, 1.0));

	// original (un-offset) control image where m = 0, stacked textures where m = 1
	vec4 original = vec4(controlColor.rgb, 1.0);
	fragColor = TDOutputSwizzle(mix(original, stacked, m));
}