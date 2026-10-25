#version 300 es
// ============================================================
// Texture Stack — WebGL2 port of texture_stack3.glsl (TouchDesigner)
//
// The TouchDesigner shader is the source of truth. This file must
// give the same pixels. Differences are only the ones WebGL needs:
//   - sTD2DInputs[] (dynamic slot index) -> one sampler2DArray (uStack)
//   - vUV / TDOutputSwizzle              -> vUv / plain output
//   - uNumImages is an int
//
// The output is always opaque (alpha = 1). The app also flattens images
// with transparency over black when it loads them.
//
// Textures:
//   uControl -> control map (video or image), RGB
//   uMask    -> mask (luminance). white = stacked, black = original control
//               With no mask loaded: set uMaskInfluence = 0 and bind any texture
//   uStack   -> TEXTURE_2D_ARRAY, one layer per image, all the same size
// ============================================================
precision highp float;
precision highp int;
precision highp sampler2DArray;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D      uControl;
uniform sampler2D      uMask;
uniform sampler2DArray uStack;

uniform int   uNumImages;      // how many images are stacked, 1..MAX_LAYERS
uniform float uSmoothBlend;    // 0.0 = hard switch, 1.0 = crossfade
uniform float uMaskInfluence;  // 0.0 = mask ignored, 1.0 = mask fully applied
uniform float uInvertMask;     // 0.0 = normal, 1.0 = flip mask
uniform float uMaskMin;        // 0-1, mask values at or below this become 0
uniform float uMaskMax;        // 0-1, mask values at or above this become 1
uniform float uContrast;       // 1.0 = unchanged, >1 = more contrast, <1 = flatter, 0 = flat grey
uniform float uOffset;         // 0-1, added to control luminance (animate this)
uniform float uCyclic;         // 1.0 = offset wraps and loops, 0.0 = clamps

const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);

vec4 fetchLayer(int i, vec2 uv)
{
	return texture(uStack, vec3(uv, float(i)));
}

void main()
{
	vec2  uv = vUv;
	int   n  = max(uNumImages, 1);
	float nf = float(n);

	vec4 controlColor = texture(uControl, uv);

	// contrast around mid-grey, applied before the luminance lookup
	vec3  contrasted = clamp((controlColor.rgb - 0.5) * uContrast + 0.5, 0.0, 1.0);
	float lum        = dot(contrasted, LUMA);

	// --- stacked texture result ---
	vec4 stacked;

	if (uCyclic > 0.5)
	{
		float scaled = fract(lum + uOffset) * nf;

		if (uSmoothBlend < 0.5)
		{
			int idx = int(floor(scaled)) % n;
			stacked = fetchLayer(idx, uv);
		}
		else
		{
			int   idxA = int(floor(scaled)) % n;
			int   idxB = (idxA + 1) % n;       // last layer blends back to the first
			float t    = fract(scaled);
			stacked = mix(fetchLayer(idxA, uv), fetchLayer(idxB, uv), t);
		}
	}
	else
	{
		float scaled = clamp(lum + uOffset, 0.0, 1.0) * (nf - 1.0);

		if (uSmoothBlend < 0.5)
		{
			int idx = clamp(int(floor(scaled + 0.5)), 0, n - 1);
			stacked = fetchLayer(idx, uv);
		}
		else
		{
			int   idxA = clamp(int(floor(scaled)), 0, n - 1);
			int   idxB = clamp(idxA + 1, 0, n - 1);
			float t    = fract(scaled);
			stacked = mix(fetchLayer(idxA, uv), fetchLayer(idxB, uv), t);
		}
	}

	// --- mask ---
	float mask = dot(texture(uMask, uv).rgb, LUMA);

	// clamp from bottom and top, then stretch the remaining range to 0-1
	float lo = min(uMaskMin, uMaskMax);
	float hi = max(uMaskMin, uMaskMax);
	mask = clamp((mask - lo) / max(hi - lo, 1e-5), 0.0, 1.0);

	mask = mix(mask, 1.0 - mask, step(0.5, uInvertMask));
	float m = mix(1.0, mask, clamp(uMaskInfluence, 0.0, 1.0));

	// original (un-contrasted, un-offset) control image where m = 0,
	// stacked textures where m = 1
	vec4 original = vec4(controlColor.rgb, 1.0);
	fragColor = vec4(mix(original.rgb, stacked.rgb, m), 1.0);
}
