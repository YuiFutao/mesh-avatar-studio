import {expect, test} from 'vitest';
import fixture from '../samples/miko-qipao/rig.json';
import {parseRig, validateRig, PARAMS} from 'mesh-avatar';
import {createRig} from '../packages/runtime/src/engine/rig.js';
import {createPhysics} from '../packages/runtime/src/engine/physics.js';
const defaults=Object.fromEntries(PARAMS.map(p=>[p.id,p.def]));
function setup(){const rig=parseRig(fixture);rig.strands=[];delete rig.buns;rig.accessories=[{name:'upright_ear',pivot:[700,500],tip:[700,150],split:.42,box:[500,100,850,550],color:{redness:.5,minRed:60},outline:[[500,100],[850,100],[800,550],[600,550]],rootCover:[[600,500],[800,500],[800,600],[600,600]],pendulum:{mode:'upright',frequency:1.5,damping:.55,inertia:.4,maxAngle:.085,maxBend:.045}}];const engine=createRig(rig);return {rig,engine,physics:new(createPhysics(engine,rig).Physics)()};}

test.each([15,30,60])('upright two-joint accessory follows head orientation, lags at its tip and settles at %i fps',fps=>{
 const {engine,physics,rig}=setup(),dt=1/fps,accessory=rig.accessories![0];
 let peak=0,bend=0;
 for(let i=0;i<fps*7;i++){
  const t=i/fps,P=t<2?{...defaults,angleX:22*Math.sin(t*6),angleZ:16*Math.sin(t*6)}:{...defaults,angleZ:12};
  physics.step(P,dt);const ch=physics.chains[0],reference=engine.attachmentAngle(accessory,P);
  const relative=ch.phi[0]-reference,flex=ch.phi[1]-ch.phi[0];peak=Math.max(peak,Math.abs(relative));bend=Math.max(bend,Math.abs(flex));
  expect(Math.abs(relative)).toBeLessThanOrEqual(.085+1e-12);expect(Math.abs(flex)).toBeLessThanOrEqual(.045+1e-12);
  const points=ch.pts!;expect(points.flat().every(Number.isFinite)).toBe(true);
  for(let k=0;k<2;k++)expect(Math.hypot(points[k+1][0]-points[k][0],points[k+1][1]-points[k][1])).toBeCloseTo(k?ch.L2:ch.L1,9);
 }
 const ch=physics.chains[0],reference=engine.attachmentAngle(accessory,{...defaults,angleZ:12});
 expect(peak).toBeGreaterThan(.005);expect(bend).toBeGreaterThan(.001);expect(ch.phi[0]).toBeCloseTo(reference,6);expect(ch.phi[1]).toBeCloseTo(reference,6);
 expect(ch.phi[0]).toBeLessThan(0); // Follows the tilted head, rather than the hanging counter-tilt.
});

test('upright accessories remain still initially, reset paused/long gaps and disable lag at zero sway gain',()=>{
 const {engine,physics,rig}=setup(),P={...defaults,angleZ:15},reference=engine.attachmentAngle(rig.accessories![0],P);
 for(let i=0;i<120;i++)physics.step(P,1/60);
 expect(physics.chains[0].phi).toEqual([reference,reference]);
 physics.step(defaults,0);expect(physics.chains[0].phi).toEqual([0,0]);
 physics.step(P,2);expect(physics.chains[0].phi).toEqual([reference,reference]);
 physics.gain=0;physics.step(defaults,1/60);for(const angle of physics.chains[0].phi)expect(angle).toBeCloseTo(0,12);
});

test('polygon cutouts and upright pendulum data validate without changing legacy accessory requirements',()=>{
 const {rig}=setup();expect(validateRig(rig)).toEqual([]);
 const a=rig.accessories![0],original=structuredClone(a);
 a.outline![0][0]=-1;expect(validateRig(rig).length).toBeGreaterThan(0);
 rig.accessories![0]=structuredClone(original);rig.accessories![0].pendulum!.maxBend=NaN;expect(validateRig(rig).length).toBeGreaterThan(0);
 rig.accessories![0]=structuredClone(original);rig.accessories![0].rootCover![0][1]=rig.image.height+1;expect(validateRig(rig).length).toBeGreaterThan(0);
 expect(validateRig(parseRig(fixture))).toEqual([]);
});
