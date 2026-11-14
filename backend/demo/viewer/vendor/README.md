three.js 0.160.0 (MIT, see LICENSE), downloaded once from
https://cdn.jsdelivr.net/npm/three@0.160.0/ : build/three.module.min.js and, from
examples/jsm/, controls/OrbitControls.js, postprocessing/{EffectComposer,RenderPass,
UnrealBloomPass,OutputPass,ShaderPass,MaskPass,Pass}.js and shaders/{CopyShader,
LuminosityHighPassShader,OutputShader}.js.

Only change: the import lines point at the files in this folder
(`'three'` became `'./three.module.min.js'`, `'../shaders/X.js'` became `'./X.js'`),
so the viewer needs no build step, no import map and no network.
