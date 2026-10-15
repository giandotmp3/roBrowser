/**
 * WGSL sources (Vite `?raw`). WGSL has no #include; shared code is composed
 * by string concatenation here, so every shader that needs fog gets the same
 * R-MAP-004 include (architecture §2.2 "Fog").
 */
import fog from './fog.wgsl?raw';
import ground from './ground.wgsl?raw';
import water from './water.wgsl?raw';
import models from './models.wgsl?raw';
import sprite from './sprite.wgsl?raw';
import str from './str.wgsl?raw';
import effect from './effect.wgsl?raw';
import gr2 from './gr2.wgsl?raw';
import blit from './blit.wgsl?raw';
import postCommon from './post/common.wgsl?raw';
import bloom from './post/bloom.wgsl?raw';
import blur from './post/blur.wgsl?raw';
import fxaa from './post/fxaa.wgsl?raw';
import cas from './post/cas.wgsl?raw';
import cartoon from './post/cartoon.wgsl?raw';
import vibrance from './post/vibrance.wgsl?raw';
import verticalFlip from './post/vertical_flip.wgsl?raw';
import blind from './post/blind.wgsl?raw';
import upsampling from './post/upsampling.wgsl?raw';

/** Shaders that include the shared fog code. */
export const FOGGED = Object.freeze(['ground', 'water', 'models', 'sprite', 'str', 'effect']);

const withFog = src => `${fog}\n${src}`;
const post = src => `${postCommon}\n${src}`;

export const SHADERS = Object.freeze({
	ground: withFog(ground),
	water: withFog(water),
	models: withFog(models),
	sprite: withFog(sprite),
	str: withFog(str),
	effect: withFog(effect),
	gr2,
	blit,
	Bloom: post(bloom),
	Blur: post(blur),
	FXAA: post(fxaa),
	CAS: post(cas),
	Cartoon: post(cartoon),
	Vibrance: post(vibrance),
	VerticalFlip: post(verticalFlip),
	Blind: post(blind),
	Upsampling: post(upsampling)
});

export const FOG_INCLUDE = fog;
