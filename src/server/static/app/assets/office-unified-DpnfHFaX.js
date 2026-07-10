import{A as e,B as t,C as n,D as r,E as i,F as a,I as o,L as s,M as c,N as l,O as u,P as d,R as f,S as p,T as m,_ as h,a as g,b as _,c as v,d as y,f as b,g as x,h as S,i as C,j as w,k as T,l as E,m as D,n as ee,o as O,p as k,r as A,s as j,t as te,u as M,v as ne,w as re,x as ie,y as ae,z as oe}from"./index-xZrqZeLx.js";var se=Object.defineProperty,N=(e,t,n)=>t in e?se(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,ce=(e,t,n)=>(N(e,typeof t==`symbol`?t:t+``,n),n),P=class{constructor(){ce(this,`_listeners`)}addEventListener(e,t){this._listeners===void 0&&(this._listeners={});let n=this._listeners;n[e]===void 0&&(n[e]=[]),n[e].indexOf(t)===-1&&n[e].push(t)}hasEventListener(e,t){if(this._listeners===void 0)return!1;let n=this._listeners;return n[e]!==void 0&&n[e].indexOf(t)!==-1}removeEventListener(e,t){if(this._listeners===void 0)return;let n=this._listeners[e];if(n!==void 0){let e=n.indexOf(t);e!==-1&&n.splice(e,1)}}dispatchEvent(e){if(this._listeners===void 0)return;let t=this._listeners[e.type];if(t!==void 0){e.target=this;let n=t.slice(0);for(let t=0,r=n.length;t<r;t++)n[t].call(this,e);e.target=null}}},le=Object.defineProperty,ue=(e,t,n)=>t in e?le(e,t,{enumerable:!0,configurable:!0,writable:!0,value:n}):e[t]=n,F=(e,t,n)=>(ue(e,typeof t==`symbol`?t:t+``,n),n),de=new m,fe=new n,pe=Math.cos(Math.PI/180*70),me=(e,t)=>(e%t+t)%t,he=class extends P{constructor(e,t){super(),F(this,`object`),F(this,`domElement`),F(this,`enabled`,!0),F(this,`target`,new c),F(this,`minDistance`,0),F(this,`maxDistance`,1/0),F(this,`minZoom`,0),F(this,`maxZoom`,1/0),F(this,`minPolarAngle`,0),F(this,`maxPolarAngle`,Math.PI),F(this,`minAzimuthAngle`,-1/0),F(this,`maxAzimuthAngle`,1/0),F(this,`enableDamping`,!1),F(this,`dampingFactor`,.05),F(this,`enableZoom`,!0),F(this,`zoomSpeed`,1),F(this,`enableRotate`,!0),F(this,`rotateSpeed`,1),F(this,`enablePan`,!0),F(this,`panSpeed`,1),F(this,`screenSpacePanning`,!0),F(this,`keyPanSpeed`,7),F(this,`zoomToCursor`,!1),F(this,`autoRotate`,!1),F(this,`autoRotateSpeed`,2),F(this,`reverseOrbit`,!1),F(this,`reverseHorizontalOrbit`,!1),F(this,`reverseVerticalOrbit`,!1),F(this,`keys`,{LEFT:`ArrowLeft`,UP:`ArrowUp`,RIGHT:`ArrowRight`,BOTTOM:`ArrowDown`}),F(this,`mouseButtons`,{LEFT:h.ROTATE,MIDDLE:h.DOLLY,RIGHT:h.PAN}),F(this,`touches`,{ONE:T.ROTATE,TWO:T.DOLLY_PAN}),F(this,`target0`),F(this,`position0`),F(this,`zoom0`),F(this,`_domElementKeyEvents`,null),F(this,`getPolarAngle`),F(this,`getAzimuthalAngle`),F(this,`setPolarAngle`),F(this,`setAzimuthalAngle`),F(this,`getDistance`),F(this,`getZoomScale`),F(this,`listenToKeyEvents`),F(this,`stopListenToKeyEvents`),F(this,`saveState`),F(this,`reset`),F(this,`update`),F(this,`connect`),F(this,`dispose`),F(this,`dollyIn`),F(this,`dollyOut`),F(this,`getScale`),F(this,`setScale`),this.object=e,this.domElement=t,this.target0=this.target.clone(),this.position0=this.object.position.clone(),this.zoom0=this.object.zoom,this.getPolarAngle=()=>d.phi,this.getAzimuthalAngle=()=>d.theta,this.setPolarAngle=e=>{let t=me(e,2*Math.PI),r=d.phi;r<0&&(r+=2*Math.PI),t<0&&(t+=2*Math.PI);let i=Math.abs(t-r);2*Math.PI-i<i&&(t<r?t+=2*Math.PI:r+=2*Math.PI),f.phi=t-r,n.update()},this.setAzimuthalAngle=e=>{let t=me(e,2*Math.PI),r=d.theta;r<0&&(r+=2*Math.PI),t<0&&(t+=2*Math.PI);let i=Math.abs(t-r);2*Math.PI-i<i&&(t<r?t+=2*Math.PI:r+=2*Math.PI),f.theta=t-r,n.update()},this.getDistance=()=>n.object.position.distanceTo(n.target),this.listenToKeyEvents=e=>{e.addEventListener(`keydown`,De),this._domElementKeyEvents=e},this.stopListenToKeyEvents=()=>{this._domElementKeyEvents.removeEventListener(`keydown`,De),this._domElementKeyEvents=null},this.saveState=()=>{n.target0.copy(n.target),n.position0.copy(n.object.position),n.zoom0=n.object.zoom},this.reset=()=>{n.target.copy(n.target0),n.object.position.copy(n.position0),n.object.zoom=n.zoom0,n.object.updateProjectionMatrix(),n.dispatchEvent(r),n.update(),s=o.NONE},this.update=(()=>{let t=new c,i=new c(0,1,0),a=new re().setFromUnitVectors(e.up,i),u=a.clone().invert(),h=new c,_=new re,v=2*Math.PI;return function(){let y=n.object.position;a.setFromUnitVectors(e.up,i),u.copy(a).invert(),t.copy(y).sub(n.target),t.applyQuaternion(a),d.setFromVector3(t),n.autoRotate&&s===o.NONE&&ne(te()),n.enableDamping?(d.theta+=f.theta*n.dampingFactor,d.phi+=f.phi*n.dampingFactor):(d.theta+=f.theta,d.phi+=f.phi);let b=n.minAzimuthAngle,x=n.maxAzimuthAngle;isFinite(b)&&isFinite(x)&&(b<-Math.PI?b+=v:b>Math.PI&&(b-=v),x<-Math.PI?x+=v:x>Math.PI&&(x-=v),b<=x?d.theta=Math.max(b,Math.min(x,d.theta)):d.theta=d.theta>(b+x)/2?Math.max(b,d.theta):Math.min(x,d.theta)),d.phi=Math.max(n.minPolarAngle,Math.min(n.maxPolarAngle,d.phi)),d.makeSafe(),n.enableDamping===!0?n.target.addScaledVector(g,n.dampingFactor):n.target.add(g),n.zoomToCursor&&k||n.object.isOrthographicCamera?d.radius=he(d.radius):d.radius=he(d.radius*m),t.setFromSpherical(d),t.applyQuaternion(u),y.copy(n.target).add(t),n.object.matrixAutoUpdate||n.object.updateMatrix(),n.object.lookAt(n.target),n.enableDamping===!0?(f.theta*=1-n.dampingFactor,f.phi*=1-n.dampingFactor,g.multiplyScalar(1-n.dampingFactor)):(f.set(0,0,0),g.set(0,0,0));let S=!1;if(n.zoomToCursor&&k){let r=null;if(n.object instanceof p&&n.object.isPerspectiveCamera){let e=t.length();r=he(e*m);let i=e-r;n.object.position.addScaledVector(ee,i),n.object.updateMatrixWorld()}else if(n.object.isOrthographicCamera){let e=new c(O.x,O.y,0);e.unproject(n.object),n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/m)),n.object.updateProjectionMatrix(),S=!0;let i=new c(O.x,O.y,0);i.unproject(n.object),n.object.position.sub(i).add(e),n.object.updateMatrixWorld(),r=t.length()}else console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - zoom to cursor disabled.`),n.zoomToCursor=!1;r!==null&&(n.screenSpacePanning?n.target.set(0,0,-1).transformDirection(n.object.matrix).multiplyScalar(r).add(n.object.position):(de.origin.copy(n.object.position),de.direction.set(0,0,-1).transformDirection(n.object.matrix),Math.abs(n.object.up.dot(de.direction))<pe?e.lookAt(n.target):(fe.setFromNormalAndCoplanarPoint(n.object.up,n.target),de.intersectPlane(fe,n.target))))}else n.object instanceof ie&&n.object.isOrthographicCamera&&(S=m!==1,S&&(n.object.zoom=Math.max(n.minZoom,Math.min(n.maxZoom,n.object.zoom/m)),n.object.updateProjectionMatrix()));return m=1,k=!1,S||h.distanceToSquared(n.object.position)>l||8*(1-_.dot(n.object.quaternion))>l?(n.dispatchEvent(r),h.copy(n.object.position),_.copy(n.object.quaternion),S=!1,!0):!1}})(),this.connect=e=>{n.domElement=e,n.domElement.style.touchAction=`none`,n.domElement.addEventListener(`contextmenu`,Y),n.domElement.addEventListener(`pointerdown`,G),n.domElement.addEventListener(`pointercancel`,q),n.domElement.addEventListener(`wheel`,Ee)},this.dispose=()=>{var e,t,r,i,a,o;n.domElement&&(n.domElement.style.touchAction=`auto`),(e=n.domElement)==null||e.removeEventListener(`contextmenu`,Y),(t=n.domElement)==null||t.removeEventListener(`pointerdown`,G),(r=n.domElement)==null||r.removeEventListener(`pointercancel`,q),(i=n.domElement)==null||i.removeEventListener(`wheel`,Ee),(a=n.domElement)==null||a.ownerDocument.removeEventListener(`pointermove`,K),(o=n.domElement)==null||o.ownerDocument.removeEventListener(`pointerup`,q),n._domElementKeyEvents!==null&&n._domElementKeyEvents.removeEventListener(`keydown`,De)};let n=this,r={type:`change`},i={type:`start`},a={type:`end`},o={NONE:-1,ROTATE:0,DOLLY:1,PAN:2,TOUCH_ROTATE:3,TOUCH_PAN:4,TOUCH_DOLLY_PAN:5,TOUCH_DOLLY_ROTATE:6},s=o.NONE,l=1e-6,d=new u,f=new u,m=1,g=new c,_=new w,v=new w,y=new w,b=new w,x=new w,S=new w,C=new w,E=new w,D=new w,ee=new c,O=new w,k=!1,A=[],j={};function te(){return 2*Math.PI/60/60*n.autoRotateSpeed}function M(){return .95**n.zoomSpeed}function ne(e){n.reverseOrbit||n.reverseHorizontalOrbit?f.theta+=e:f.theta-=e}function ae(e){n.reverseOrbit||n.reverseVerticalOrbit?f.phi+=e:f.phi-=e}let oe=(()=>{let e=new c;return function(t,n){e.setFromMatrixColumn(n,0),e.multiplyScalar(-t),g.add(e)}})(),se=(()=>{let e=new c;return function(t,r){n.screenSpacePanning===!0?e.setFromMatrixColumn(r,1):(e.setFromMatrixColumn(r,0),e.crossVectors(n.object.up,e)),e.multiplyScalar(t),g.add(e)}})(),N=(()=>{let e=new c;return function(t,r){let i=n.domElement;if(i&&n.object instanceof p&&n.object.isPerspectiveCamera){let a=n.object.position;e.copy(a).sub(n.target);let o=e.length();o*=Math.tan(n.object.fov/2*Math.PI/180),oe(2*t*o/i.clientHeight,n.object.matrix),se(2*r*o/i.clientHeight,n.object.matrix)}else i&&n.object instanceof ie&&n.object.isOrthographicCamera?(oe(t*(n.object.right-n.object.left)/n.object.zoom/i.clientWidth,n.object.matrix),se(r*(n.object.top-n.object.bottom)/n.object.zoom/i.clientHeight,n.object.matrix)):(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - pan disabled.`),n.enablePan=!1)}})();function ce(e){n.object instanceof p&&n.object.isPerspectiveCamera||n.object instanceof ie&&n.object.isOrthographicCamera?m=e:(console.warn(`WARNING: OrbitControls.js encountered an unknown camera type - dolly/zoom disabled.`),n.enableZoom=!1)}function P(e){ce(m/e)}function le(e){ce(m*e)}function ue(e){if(!n.zoomToCursor||!n.domElement)return;k=!0;let t=n.domElement.getBoundingClientRect(),r=e.clientX-t.left,i=e.clientY-t.top,a=t.width,o=t.height;O.x=r/a*2-1,O.y=-(i/o)*2+1,ee.set(O.x,O.y,1).unproject(n.object).sub(n.object.position).normalize()}function he(e){return Math.max(n.minDistance,Math.min(n.maxDistance,e))}function ge(e){_.set(e.clientX,e.clientY)}function I(e){ue(e),C.set(e.clientX,e.clientY)}function L(e){b.set(e.clientX,e.clientY)}function _e(e){v.set(e.clientX,e.clientY),y.subVectors(v,_).multiplyScalar(n.rotateSpeed);let t=n.domElement;t&&(ne(2*Math.PI*y.x/t.clientHeight),ae(2*Math.PI*y.y/t.clientHeight)),_.copy(v),n.update()}function ve(e){E.set(e.clientX,e.clientY),D.subVectors(E,C),D.y>0?P(M()):D.y<0&&le(M()),C.copy(E),n.update()}function ye(e){x.set(e.clientX,e.clientY),S.subVectors(x,b).multiplyScalar(n.panSpeed),N(S.x,S.y),b.copy(x),n.update()}function be(e){ue(e),e.deltaY<0?le(M()):e.deltaY>0&&P(M()),n.update()}function xe(e){let t=!1;switch(e.code){case n.keys.UP:N(0,n.keyPanSpeed),t=!0;break;case n.keys.BOTTOM:N(0,-n.keyPanSpeed),t=!0;break;case n.keys.LEFT:N(n.keyPanSpeed,0),t=!0;break;case n.keys.RIGHT:N(-n.keyPanSpeed,0),t=!0;break}t&&(e.preventDefault(),n.update())}function Se(){if(A.length==1)_.set(A[0].pageX,A[0].pageY);else{let e=.5*(A[0].pageX+A[1].pageX),t=.5*(A[0].pageY+A[1].pageY);_.set(e,t)}}function Ce(){if(A.length==1)b.set(A[0].pageX,A[0].pageY);else{let e=.5*(A[0].pageX+A[1].pageX),t=.5*(A[0].pageY+A[1].pageY);b.set(e,t)}}function R(){let e=A[0].pageX-A[1].pageX,t=A[0].pageY-A[1].pageY,n=Math.sqrt(e*e+t*t);C.set(0,n)}function z(){n.enableZoom&&R(),n.enablePan&&Ce()}function B(){n.enableZoom&&R(),n.enableRotate&&Se()}function V(e){if(A.length==1)v.set(e.pageX,e.pageY);else{let t=Me(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);v.set(n,r)}y.subVectors(v,_).multiplyScalar(n.rotateSpeed);let t=n.domElement;t&&(ne(2*Math.PI*y.x/t.clientHeight),ae(2*Math.PI*y.y/t.clientHeight)),_.copy(v)}function H(e){if(A.length==1)x.set(e.pageX,e.pageY);else{let t=Me(e),n=.5*(e.pageX+t.x),r=.5*(e.pageY+t.y);x.set(n,r)}S.subVectors(x,b).multiplyScalar(n.panSpeed),N(S.x,S.y),b.copy(x)}function U(e){let t=Me(e),r=e.pageX-t.x,i=e.pageY-t.y,a=Math.sqrt(r*r+i*i);E.set(0,a),D.set(0,(E.y/C.y)**+n.zoomSpeed),P(D.y),C.copy(E)}function we(e){n.enableZoom&&U(e),n.enablePan&&H(e)}function W(e){n.enableZoom&&U(e),n.enableRotate&&V(e)}function G(e){var t,r;n.enabled!==!1&&(A.length===0&&((t=n.domElement)==null||t.ownerDocument.addEventListener(`pointermove`,K),(r=n.domElement)==null||r.ownerDocument.addEventListener(`pointerup`,q)),Ae(e),e.pointerType===`touch`?Oe(e):J(e))}function K(e){n.enabled!==!1&&(e.pointerType===`touch`?ke(e):Te(e))}function q(e){var t,r,i;X(e),A.length===0&&((t=n.domElement)==null||t.releasePointerCapture(e.pointerId),(r=n.domElement)==null||r.ownerDocument.removeEventListener(`pointermove`,K),(i=n.domElement)==null||i.ownerDocument.removeEventListener(`pointerup`,q)),n.dispatchEvent(a),s=o.NONE}function J(e){let t;switch(e.button){case 0:t=n.mouseButtons.LEFT;break;case 1:t=n.mouseButtons.MIDDLE;break;case 2:t=n.mouseButtons.RIGHT;break;default:t=-1}switch(t){case h.DOLLY:if(n.enableZoom===!1)return;I(e),s=o.DOLLY;break;case h.ROTATE:if(e.ctrlKey||e.metaKey||e.shiftKey){if(n.enablePan===!1)return;L(e),s=o.PAN}else{if(n.enableRotate===!1)return;ge(e),s=o.ROTATE}break;case h.PAN:if(e.ctrlKey||e.metaKey||e.shiftKey){if(n.enableRotate===!1)return;ge(e),s=o.ROTATE}else{if(n.enablePan===!1)return;L(e),s=o.PAN}break;default:s=o.NONE}s!==o.NONE&&n.dispatchEvent(i)}function Te(e){if(n.enabled!==!1)switch(s){case o.ROTATE:if(n.enableRotate===!1)return;_e(e);break;case o.DOLLY:if(n.enableZoom===!1)return;ve(e);break;case o.PAN:if(n.enablePan===!1)return;ye(e);break}}function Ee(e){n.enabled===!1||n.enableZoom===!1||s!==o.NONE&&s!==o.ROTATE||(e.preventDefault(),n.dispatchEvent(i),be(e),n.dispatchEvent(a))}function De(e){n.enabled===!1||n.enablePan===!1||xe(e)}function Oe(e){switch(je(e),A.length){case 1:switch(n.touches.ONE){case T.ROTATE:if(n.enableRotate===!1)return;Se(),s=o.TOUCH_ROTATE;break;case T.PAN:if(n.enablePan===!1)return;Ce(),s=o.TOUCH_PAN;break;default:s=o.NONE}break;case 2:switch(n.touches.TWO){case T.DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;z(),s=o.TOUCH_DOLLY_PAN;break;case T.DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;B(),s=o.TOUCH_DOLLY_ROTATE;break;default:s=o.NONE}break;default:s=o.NONE}s!==o.NONE&&n.dispatchEvent(i)}function ke(e){switch(je(e),s){case o.TOUCH_ROTATE:if(n.enableRotate===!1)return;V(e),n.update();break;case o.TOUCH_PAN:if(n.enablePan===!1)return;H(e),n.update();break;case o.TOUCH_DOLLY_PAN:if(n.enableZoom===!1&&n.enablePan===!1)return;we(e),n.update();break;case o.TOUCH_DOLLY_ROTATE:if(n.enableZoom===!1&&n.enableRotate===!1)return;W(e),n.update();break;default:s=o.NONE}}function Y(e){n.enabled!==!1&&e.preventDefault()}function Ae(e){A.push(e)}function X(e){delete j[e.pointerId];for(let t=0;t<A.length;t++)if(A[t].pointerId==e.pointerId){A.splice(t,1);return}}function je(e){let t=j[e.pointerId];t===void 0&&(t=new w,j[e.pointerId]=t),t.set(e.pageX,e.pageY)}function Me(e){return j[(e.pointerId===A[0].pointerId?A[1]:A[0]).pointerId]}this.dollyIn=(e=M())=>{le(e),n.update()},this.dollyOut=(e=M())=>{P(e),n.update()},this.getScale=()=>m,this.setScale=e=>{ce(e),n.update()},this.getZoomScale=()=>M(),t!==void 0&&this.connect(t),this.update()}},ge=new E,I=new c,L=class extends k{constructor(){super(),this.isLineSegmentsGeometry=!0,this.type=`LineSegmentsGeometry`,this.setIndex([0,2,1,2,3,1,2,4,3,4,5,3,4,6,5,6,7,5]),this.setAttribute(`position`,new b([-1,2,0,1,2,0,-1,1,0,1,1,0,-1,0,0,1,0,0,-1,-1,0,1,-1,0],3)),this.setAttribute(`uv`,new b([-1,2,1,2,-1,1,1,1,-1,-1,1,-1,-1,-2,1,-2],2))}applyMatrix4(e){let t=this.attributes.instanceStart,n=this.attributes.instanceEnd;return t!==void 0&&(t.applyMatrix4(e),n.applyMatrix4(e),t.needsUpdate=!0),this.boundingBox!==null&&this.computeBoundingBox(),this.boundingSphere!==null&&this.computeBoundingSphere(),this}setPositions(e){let t;e instanceof Float32Array?t=e:Array.isArray(e)&&(t=new Float32Array(e));let n=new D(t,6,1);return this.setAttribute(`instanceStart`,new S(n,3,0)),this.setAttribute(`instanceEnd`,new S(n,3,3)),this.computeBoundingBox(),this.computeBoundingSphere(),this}setColors(e,t=3){let n;e instanceof Float32Array?n=e:Array.isArray(e)&&(n=new Float32Array(e));let r=new D(n,t*2,1);return this.setAttribute(`instanceColorStart`,new S(r,t,0)),this.setAttribute(`instanceColorEnd`,new S(r,t,t)),this}fromWireframeGeometry(e){return this.setPositions(e.attributes.position.array),this}fromEdgesGeometry(e){return this.setPositions(e.attributes.position.array),this}fromMesh(e){return this.fromWireframeGeometry(new d(e.geometry)),this}fromLineSegments(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}computeBoundingBox(){this.boundingBox===null&&(this.boundingBox=new E);let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;e!==void 0&&t!==void 0&&(this.boundingBox.setFromBufferAttribute(e),ge.setFromBufferAttribute(t),this.boundingBox.union(ge))}computeBoundingSphere(){this.boundingSphere===null&&(this.boundingSphere=new r),this.boundingBox===null&&this.computeBoundingBox();let e=this.attributes.instanceStart,t=this.attributes.instanceEnd;if(e!==void 0&&t!==void 0){let n=this.boundingSphere.center;this.boundingBox.getCenter(n);let r=0;for(let i=0,a=e.count;i<a;i++)I.fromBufferAttribute(e,i),r=Math.max(r,n.distanceToSquared(I)),I.fromBufferAttribute(t,i),r=Math.max(r,n.distanceToSquared(I));this.boundingSphere.radius=Math.sqrt(r),isNaN(this.boundingSphere.radius)&&console.error(`THREE.LineSegmentsGeometry.computeBoundingSphere(): Computed radius is NaN. The instanced position data is likely to have NaN values.`,this)}}toJSON(){}applyMatrix(e){return console.warn(`THREE.LineSegmentsGeometry: applyMatrix() has been renamed to applyMatrix4().`),this.applyMatrix4(e)}},_e=class extends L{constructor(){super(),this.isLineGeometry=!0,this.type=`LineGeometry`}setPositions(e){let t=e.length-3,n=new Float32Array(2*t);for(let r=0;r<t;r+=3)n[2*r]=e[r],n[2*r+1]=e[r+1],n[2*r+2]=e[r+2],n[2*r+3]=e[r+3],n[2*r+4]=e[r+4],n[2*r+5]=e[r+5];return super.setPositions(n),this}setColors(e,t=3){let n=e.length-t,r=new Float32Array(2*n);if(t===3)for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5];else for(let i=0;i<n;i+=t)r[2*i]=e[i],r[2*i+1]=e[i+1],r[2*i+2]=e[i+2],r[2*i+3]=e[i+3],r[2*i+4]=e[i+4],r[2*i+5]=e[i+5],r[2*i+6]=e[i+6],r[2*i+7]=e[i+7];return super.setColors(r,t),this}fromLine(e){let t=e.geometry;return this.setPositions(t.attributes.position.array),this}},ve=parseInt(`185`.replace(/\D+/g,``)),ye=class extends i{constructor(t){super({type:`LineMaterial`,uniforms:e.clone(e.merge([v.common,v.fog,{worldUnits:{value:1},linewidth:{value:1},resolution:{value:new w(1,1)},dashOffset:{value:0},dashScale:{value:1},dashSize:{value:1},gapSize:{value:1}}])),vertexShader:`
				#include <common>
				#include <fog_pars_vertex>
				#include <logdepthbuf_pars_vertex>
				#include <clipping_planes_pars_vertex>

				uniform float linewidth;
				uniform vec2 resolution;

				attribute vec3 instanceStart;
				attribute vec3 instanceEnd;

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
						attribute vec4 instanceColorStart;
						attribute vec4 instanceColorEnd;
					#else
						varying vec3 vLineColor;
						attribute vec3 instanceColorStart;
						attribute vec3 instanceColorEnd;
					#endif
				#endif

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#ifdef USE_DASH

					uniform float dashScale;
					attribute float instanceDistanceStart;
					attribute float instanceDistanceEnd;
					varying float vLineDistance;

				#endif

				void trimSegment( const in vec4 start, inout vec4 end ) {

					// trim end segment so it terminates between the camera plane and the near plane

					// conservative estimate of the near plane
					float a = projectionMatrix[ 2 ][ 2 ]; // 3nd entry in 3th column
					float b = projectionMatrix[ 3 ][ 2 ]; // 3nd entry in 4th column
					float nearEstimate = - 0.5 * b / a;

					float alpha = ( nearEstimate - start.z ) / ( end.z - start.z );

					end.xyz = mix( start.xyz, end.xyz, alpha );

				}

				void main() {

					#ifdef USE_COLOR

						vLineColor = ( position.y < 0.5 ) ? instanceColorStart : instanceColorEnd;

					#endif

					#ifdef USE_DASH

						vLineDistance = ( position.y < 0.5 ) ? dashScale * instanceDistanceStart : dashScale * instanceDistanceEnd;
						vUv = uv;

					#endif

					float aspect = resolution.x / resolution.y;

					// camera space
					vec4 start = modelViewMatrix * vec4( instanceStart, 1.0 );
					vec4 end = modelViewMatrix * vec4( instanceEnd, 1.0 );

					#ifdef WORLD_UNITS

						worldStart = start.xyz;
						worldEnd = end.xyz;

					#else

						vUv = uv;

					#endif

					// special case for perspective projection, and segments that terminate either in, or behind, the camera plane
					// clearly the gpu firmware has a way of addressing this issue when projecting into ndc space
					// but we need to perform ndc-space calculations in the shader, so we must address this issue directly
					// perhaps there is a more elegant solution -- WestLangley

					bool perspective = ( projectionMatrix[ 2 ][ 3 ] == - 1.0 ); // 4th entry in the 3rd column

					if ( perspective ) {

						if ( start.z < 0.0 && end.z >= 0.0 ) {

							trimSegment( start, end );

						} else if ( end.z < 0.0 && start.z >= 0.0 ) {

							trimSegment( end, start );

						}

					}

					// clip space
					vec4 clipStart = projectionMatrix * start;
					vec4 clipEnd = projectionMatrix * end;

					// ndc space
					vec3 ndcStart = clipStart.xyz / clipStart.w;
					vec3 ndcEnd = clipEnd.xyz / clipEnd.w;

					// direction
					vec2 dir = ndcEnd.xy - ndcStart.xy;

					// account for clip-space aspect ratio
					dir.x *= aspect;
					dir = normalize( dir );

					#ifdef WORLD_UNITS

						// get the offset direction as perpendicular to the view vector
						vec3 worldDir = normalize( end.xyz - start.xyz );
						vec3 offset;
						if ( position.y < 0.5 ) {

							offset = normalize( cross( start.xyz, worldDir ) );

						} else {

							offset = normalize( cross( end.xyz, worldDir ) );

						}

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						float forwardOffset = dot( worldDir, vec3( 0.0, 0.0, 1.0 ) );

						// don't extend the line if we're rendering dashes because we
						// won't be rendering the endcaps
						#ifndef USE_DASH

							// extend the line bounds to encompass  endcaps
							start.xyz += - worldDir * linewidth * 0.5;
							end.xyz += worldDir * linewidth * 0.5;

							// shift the position of the quad so it hugs the forward edge of the line
							offset.xy -= dir * forwardOffset;
							offset.z += 0.5;

						#endif

						// endcaps
						if ( position.y > 1.0 || position.y < 0.0 ) {

							offset.xy += dir * 2.0 * forwardOffset;

						}

						// adjust for linewidth
						offset *= linewidth * 0.5;

						// set the world position
						worldPos = ( position.y < 0.5 ) ? start : end;
						worldPos.xyz += offset;

						// project the worldpos
						vec4 clip = projectionMatrix * worldPos;

						// shift the depth of the projected points so the line
						// segments overlap neatly
						vec3 clipPose = ( position.y < 0.5 ) ? ndcStart : ndcEnd;
						clip.z = clipPose.z * clip.w;

					#else

						vec2 offset = vec2( dir.y, - dir.x );
						// undo aspect ratio adjustment
						dir.x /= aspect;
						offset.x /= aspect;

						// sign flip
						if ( position.x < 0.0 ) offset *= - 1.0;

						// endcaps
						if ( position.y < 0.0 ) {

							offset += - dir;

						} else if ( position.y > 1.0 ) {

							offset += dir;

						}

						// adjust for linewidth
						offset *= linewidth;

						// adjust for clip-space to screen-space conversion // maybe resolution should be based on viewport ...
						offset /= resolution.y;

						// select end
						vec4 clip = ( position.y < 0.5 ) ? clipStart : clipEnd;

						// back to clip space
						offset *= clip.w;

						clip.xy += offset;

					#endif

					gl_Position = clip;

					vec4 mvPosition = ( position.y < 0.5 ) ? start : end; // this is an approximation

					#include <logdepthbuf_vertex>
					#include <clipping_planes_vertex>
					#include <fog_vertex>

				}
			`,fragmentShader:`
				uniform vec3 diffuse;
				uniform float opacity;
				uniform float linewidth;

				#ifdef USE_DASH

					uniform float dashOffset;
					uniform float dashSize;
					uniform float gapSize;

				#endif

				varying float vLineDistance;

				#ifdef WORLD_UNITS

					varying vec4 worldPos;
					varying vec3 worldStart;
					varying vec3 worldEnd;

					#ifdef USE_DASH

						varying vec2 vUv;

					#endif

				#else

					varying vec2 vUv;

				#endif

				#include <common>
				#include <fog_pars_fragment>
				#include <logdepthbuf_pars_fragment>
				#include <clipping_planes_pars_fragment>

				#ifdef USE_COLOR
					#ifdef USE_LINE_COLOR_ALPHA
						varying vec4 vLineColor;
					#else
						varying vec3 vLineColor;
					#endif
				#endif

				vec2 closestLineToLine(vec3 p1, vec3 p2, vec3 p3, vec3 p4) {

					float mua;
					float mub;

					vec3 p13 = p1 - p3;
					vec3 p43 = p4 - p3;

					vec3 p21 = p2 - p1;

					float d1343 = dot( p13, p43 );
					float d4321 = dot( p43, p21 );
					float d1321 = dot( p13, p21 );
					float d4343 = dot( p43, p43 );
					float d2121 = dot( p21, p21 );

					float denom = d2121 * d4343 - d4321 * d4321;

					float numer = d1343 * d4321 - d1321 * d4343;

					mua = numer / denom;
					mua = clamp( mua, 0.0, 1.0 );
					mub = ( d1343 + d4321 * ( mua ) ) / d4343;
					mub = clamp( mub, 0.0, 1.0 );

					return vec2( mua, mub );

				}

				void main() {

					#include <clipping_planes_fragment>

					#ifdef USE_DASH

						if ( vUv.y < - 1.0 || vUv.y > 1.0 ) discard; // discard endcaps

						if ( mod( vLineDistance + dashOffset, dashSize + gapSize ) > dashSize ) discard; // todo - FIX

					#endif

					float alpha = opacity;

					#ifdef WORLD_UNITS

						// Find the closest points on the view ray and the line segment
						vec3 rayEnd = normalize( worldPos.xyz ) * 1e5;
						vec3 lineDir = worldEnd - worldStart;
						vec2 params = closestLineToLine( worldStart, worldEnd, vec3( 0.0, 0.0, 0.0 ), rayEnd );

						vec3 p1 = worldStart + lineDir * params.x;
						vec3 p2 = rayEnd * params.y;
						vec3 delta = p1 - p2;
						float len = length( delta );
						float norm = len / linewidth;

						#ifndef USE_DASH

							#ifdef USE_ALPHA_TO_COVERAGE

								float dnorm = fwidth( norm );
								alpha = 1.0 - smoothstep( 0.5 - dnorm, 0.5 + dnorm, norm );

							#else

								if ( norm > 0.5 ) {

									discard;

								}

							#endif

						#endif

					#else

						#ifdef USE_ALPHA_TO_COVERAGE

							// artifacts appear on some hardware if a derivative is taken within a conditional
							float a = vUv.x;
							float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
							float len2 = a * a + b * b;
							float dlen = fwidth( len2 );

							if ( abs( vUv.y ) > 1.0 ) {

								alpha = 1.0 - smoothstep( 1.0 - dlen, 1.0 + dlen, len2 );

							}

						#else

							if ( abs( vUv.y ) > 1.0 ) {

								float a = vUv.x;
								float b = ( vUv.y > 0.0 ) ? vUv.y - 1.0 : vUv.y + 1.0;
								float len2 = a * a + b * b;

								if ( len2 > 1.0 ) discard;

							}

						#endif

					#endif

					vec4 diffuseColor = vec4( diffuse, alpha );
					#ifdef USE_COLOR
						#ifdef USE_LINE_COLOR_ALPHA
							diffuseColor *= vLineColor;
						#else
							diffuseColor.rgb *= vLineColor;
						#endif
					#endif

					#include <logdepthbuf_fragment>

					gl_FragColor = diffuseColor;

					#include <tonemapping_fragment>
					#include <${ve>=154?`colorspace_fragment`:`encodings_fragment`}>
					#include <fog_fragment>
					#include <premultiplied_alpha_fragment>

				}
			`,clipping:!0}),this.isLineMaterial=!0,this.onBeforeCompile=function(){this.transparent?this.defines.USE_LINE_COLOR_ALPHA=`1`:delete this.defines.USE_LINE_COLOR_ALPHA},Object.defineProperties(this,{color:{enumerable:!0,get:function(){return this.uniforms.diffuse.value},set:function(e){this.uniforms.diffuse.value=e}},worldUnits:{enumerable:!0,get:function(){return`WORLD_UNITS`in this.defines},set:function(e){e===!0?this.defines.WORLD_UNITS=``:delete this.defines.WORLD_UNITS}},linewidth:{enumerable:!0,get:function(){return this.uniforms.linewidth.value},set:function(e){this.uniforms.linewidth.value=e}},dashed:{enumerable:!0,get:function(){return`USE_DASH`in this.defines},set(e){!!e!=`USE_DASH`in this.defines&&(this.needsUpdate=!0),e===!0?this.defines.USE_DASH=``:delete this.defines.USE_DASH}},dashScale:{enumerable:!0,get:function(){return this.uniforms.dashScale.value},set:function(e){this.uniforms.dashScale.value=e}},dashSize:{enumerable:!0,get:function(){return this.uniforms.dashSize.value},set:function(e){this.uniforms.dashSize.value=e}},dashOffset:{enumerable:!0,get:function(){return this.uniforms.dashOffset.value},set:function(e){this.uniforms.dashOffset.value=e}},gapSize:{enumerable:!0,get:function(){return this.uniforms.gapSize.value},set:function(e){this.uniforms.gapSize.value=e}},opacity:{enumerable:!0,get:function(){return this.uniforms.opacity.value},set:function(e){this.uniforms.opacity.value=e}},resolution:{enumerable:!0,get:function(){return this.uniforms.resolution.value},set:function(e){this.uniforms.resolution.value.copy(e)}},alphaToCoverage:{enumerable:!0,get:function(){return`USE_ALPHA_TO_COVERAGE`in this.defines},set:function(e){!!e!=`USE_ALPHA_TO_COVERAGE`in this.defines&&(this.needsUpdate=!0),e===!0?(this.defines.USE_ALPHA_TO_COVERAGE=``,this.extensions.derivatives=!0):(delete this.defines.USE_ALPHA_TO_COVERAGE,this.extensions.derivatives=!1)}}}),this.setValues(t)}},be=ve>=125?`uv1`:`uv2`,xe=new l,Se=new c,Ce=new c,R=new l,z=new l,B=new l,V=new c,H=new ae,U=new x,we=new c,W=new E,G=new r,K=new l,q,J;function Te(e,t,n){return K.set(0,0,-t,1).applyMatrix4(e.projectionMatrix),K.multiplyScalar(1/K.w),K.x=J/n.width,K.y=J/n.height,K.applyMatrix4(e.projectionMatrixInverse),K.multiplyScalar(1/K.w),Math.abs(Math.max(K.x,K.y))}function Ee(e,t){let n=e.matrixWorld,r=e.geometry,i=r.attributes.instanceStart,a=r.attributes.instanceEnd,o=Math.min(r.instanceCount,i.count);for(let r=0,s=o;r<s;r++){U.start.fromBufferAttribute(i,r),U.end.fromBufferAttribute(a,r),U.applyMatrix4(n);let o=new c,s=new c;q.distanceSqToSegment(U.start,U.end,s,o),s.distanceTo(o)<J*.5&&t.push({point:s,pointOnLine:o,distance:q.origin.distanceTo(s),object:e,face:null,faceIndex:r,uv:null,[be]:null})}}function De(e,t,n){let r=t.projectionMatrix,i=e.material.resolution,a=e.matrixWorld,o=e.geometry,s=o.attributes.instanceStart,l=o.attributes.instanceEnd,u=Math.min(o.instanceCount,s.count),d=-t.near;q.at(1,B),B.w=1,B.applyMatrix4(t.matrixWorldInverse),B.applyMatrix4(r),B.multiplyScalar(1/B.w),B.x*=i.x/2,B.y*=i.y/2,B.z=0,V.copy(B),H.multiplyMatrices(t.matrixWorldInverse,a);for(let t=0,o=u;t<o;t++){if(R.fromBufferAttribute(s,t),z.fromBufferAttribute(l,t),R.w=1,z.w=1,R.applyMatrix4(H),z.applyMatrix4(H),R.z>d&&z.z>d)continue;if(R.z>d){let e=R.z-z.z,t=(R.z-d)/e;R.lerp(z,t)}else if(z.z>d){let e=z.z-R.z,t=(z.z-d)/e;z.lerp(R,t)}R.applyMatrix4(r),z.applyMatrix4(r),R.multiplyScalar(1/R.w),z.multiplyScalar(1/z.w),R.x*=i.x/2,R.y*=i.y/2,z.x*=i.x/2,z.y*=i.y/2,U.start.copy(R),U.start.z=0,U.end.copy(z),U.end.z=0;let o=U.closestPointToPointParameter(V,!0);U.at(o,we);let u=ne.lerp(R.z,z.z,o),f=u>=-1&&u<=1,p=V.distanceTo(we)<J*.5;if(f&&p){U.start.fromBufferAttribute(s,t),U.end.fromBufferAttribute(l,t),U.start.applyMatrix4(a),U.end.applyMatrix4(a);let r=new c,i=new c;q.distanceSqToSegment(U.start,U.end,i,r),n.push({point:i,pointOnLine:r,distance:q.origin.distanceTo(i),object:e,face:null,faceIndex:t,uv:null,[be]:null})}}}var Oe=class extends _{constructor(e=new L,t=new ye({color:Math.random()*16777215})){super(e,t),this.isLineSegments2=!0,this.type=`LineSegments2`}computeLineDistances(){let e=this.geometry,t=e.attributes.instanceStart,n=e.attributes.instanceEnd,r=new Float32Array(2*t.count);for(let e=0,i=0,a=t.count;e<a;e++,i+=2)Se.fromBufferAttribute(t,e),Ce.fromBufferAttribute(n,e),r[i]=i===0?0:r[i-1],r[i+1]=r[i]+Se.distanceTo(Ce);let i=new D(r,2,1);return e.setAttribute(`instanceDistanceStart`,new S(i,1,0)),e.setAttribute(`instanceDistanceEnd`,new S(i,1,1)),this}raycast(e,t){let n=this.material.worldUnits,r=e.camera;r===null&&!n&&console.error(`LineSegments2: "Raycaster.camera" needs to be set in order to raycast against LineSegments2 while worldUnits is set to false.`);let i=e.params.Line2===void 0?0:e.params.Line2.threshold||0;q=e.ray;let a=this.matrixWorld,o=this.geometry,s=this.material;J=s.linewidth+i,o.boundingSphere===null&&o.computeBoundingSphere(),G.copy(o.boundingSphere).applyMatrix4(a);let c;if(c=n?J*.5:Te(r,Math.max(r.near,G.distanceToPoint(q.origin)),s.resolution),G.radius+=c,q.intersectsSphere(G)===!1)return;o.boundingBox===null&&o.computeBoundingBox(),W.copy(o.boundingBox).applyMatrix4(a);let l;l=n?J*.5:Te(r,Math.max(r.near,W.distanceToPoint(q.origin)),s.resolution),W.expandByScalar(l),q.intersectsBox(W)!==!1&&(n?Ee(this,t):De(this,r,t))}onBeforeRender(e){let t=this.material.uniforms;t&&t.resolution&&(e.getViewport(xe),this.material.uniforms.resolution.value.set(xe.z,xe.w))}},ke=class extends Oe{constructor(e=new _e,t=new ye({color:Math.random()*16777215})){super(e,t),this.isLine2=!0,this.type=`Line2`}},Y=t(oe()),Ae=Y.forwardRef(function({points:e,color:t=16777215,vertexColors:n,linewidth:r,lineWidth:i,segments:o,dashed:s,...u},d){var f;let p=j(e=>e.size),m=Y.useMemo(()=>o?new Oe:new ke,[o]),[h]=Y.useState(()=>new ye),g=(n==null||(f=n[0])==null?void 0:f.length)===4?4:3,_=Y.useMemo(()=>{let r=o?new L:new _e,i=e.map(e=>{let t=Array.isArray(e);return e instanceof c||e instanceof l?[e.x,e.y,e.z]:e instanceof w?[e.x,e.y,0]:t&&e.length===3?[e[0],e[1],e[2]]:t&&e.length===2?[e[0],e[1],0]:e});if(r.setPositions(i.flat()),n){t=16777215;let e=n.map(e=>e instanceof M?e.toArray():e);r.setColors(e.flat(),g)}return r},[e,o,n,g]);return Y.useLayoutEffect(()=>{m.computeLineDistances()},[e,m]),Y.useLayoutEffect(()=>{s?h.defines.USE_DASH=``:delete h.defines.USE_DASH,h.needsUpdate=!0},[s,h]),Y.useEffect(()=>()=>{_.dispose(),h.dispose()},[_]),Y.createElement(`primitive`,a({object:m,ref:d},u),Y.createElement(`primitive`,{object:_,attach:`geometry`}),Y.createElement(`primitive`,a({object:h,attach:`material`,color:t,vertexColors:!!n,resolution:[p.width,p.height],linewidth:r??i??1,dashed:s,transparent:g===4},u)))}),X=Y.forwardRef(({threshold:e=15,geometry:t,...n},r)=>{let i=Y.useRef(null);Y.useImperativeHandle(r,()=>i.current,[]);let o=Y.useMemo(()=>[0,0,0,1,0,0],[]),s=Y.useRef(null),c=Y.useRef(null);return Y.useLayoutEffect(()=>{let n=i.current.parent,r=t??n?.geometry;if(!r||s.current===r&&c.current===e)return;s.current=r,c.current=e;let a=new y(r,e).attributes.position.array;i.current.geometry.setPositions(a),i.current.geometry.attributes.instanceStart.needsUpdate=!0,i.current.geometry.attributes.instanceEnd.needsUpdate=!0,i.current.computeLineDistances()}),Y.createElement(Ae,a({segments:!0,points:o,ref:i,raycast:()=>null},n))}),je=Y.forwardRef(({makeDefault:e,camera:t,regress:n,domElement:r,enableDamping:i=!0,keyEvents:o=!1,onChange:s,onStart:c,onEnd:l,...u},d)=>{let f=j(e=>e.invalidate),p=j(e=>e.camera),m=j(e=>e.gl),h=j(e=>e.events),g=j(e=>e.setEvents),_=j(e=>e.set),v=j(e=>e.get),y=j(e=>e.performance),b=t||p,x=r||h.connected||m.domElement,S=Y.useMemo(()=>new he(b),[b]);return O(()=>{S.enabled&&S.update()},-1),Y.useEffect(()=>(o&&S.connect(o===!0?x:o),S.connect(x),()=>void S.dispose()),[o,x,n,S,f]),Y.useEffect(()=>{let e=e=>{f(),n&&y.regress(),s&&s(e)},t=e=>{c&&c(e)},r=e=>{l&&l(e)};return S.addEventListener(`change`,e),S.addEventListener(`start`,t),S.addEventListener(`end`,r),()=>{S.removeEventListener(`start`,t),S.removeEventListener(`end`,r),S.removeEventListener(`change`,e)}},[s,c,l,S,f,g]),Y.useEffect(()=>{if(e){let e=v().controls;return _({controls:S}),()=>_({controls:e})}},[e,S]),Y.createElement(`primitive`,a({ref:d,object:S,enableDamping:i},u))});function Me(e,t){switch(t){case`started`:return`working`;case`failed`:return`idle`;default:return e}}function Ne(e){let t=new Map,n=e=>{let n=t.get(e);return n||(n={id:e,state:`idle`,taskTitle:null,stepTitle:null,phase:null,attemptId:null,consultWith:null,picTasks:new Set},t.set(e,n)),n},r=e=>{if(e.consultWith){let n=t.get(e.consultWith);n&&n.consultWith===e.id&&(n.consultWith=null)}e.consultWith=null};for(let i of e)switch(i.kind){case`assignment`:i.body.pic&&i.body.task_id&&n(i.body.pic).picTasks.add(i.body.task_id);break;case`step_status`:{let e=i.body.assigned_to;if(!e)break;let t=n(e);r(t);let a=i.body.attempt_id??null;if(!a&&i.body.status===`started`)t.attemptId=null,t.phase=null;else if(a&&t.attemptId&&a!==t.attemptId)break;else a&&(t.attemptId=a);t.taskTitle=i.body.task_title??t.taskTitle,t.stepTitle=i.body.step_title??t.stepTitle,t.phase=i.body.phase??t.phase,t.state=Me(t.state===`idle`?`assigned`:t.state,i.body.status);break}case`handoff`:{let e=n(i.body.assigned_to??i.author);r(e),e.taskTitle=i.body.task_title??e.taskTitle,e.stepTitle=i.body.step_title??e.stepTitle,e.state=`done`;break}case`milestone`:if(i.body.milestone===`done`&&i.body.task_id)for(let e of t.values())e.picTasks.delete(i.body.task_id);break;case`review`:{let e=n(i.body.assigned_to??i.author);r(e),e.taskTitle=i.body.task_title??e.taskTitle,e.stepTitle=i.body.step_title??e.stepTitle,e.state=`done`;break}case`consult`:{let e=i.body.from,t=i.body.to;e&&(n(e).consultWith=t??null),t&&(n(t).consultWith=e??null);break}case`ceo`:break;default:break}return t}function Pe(e){let t=[],n=new Set,r=e=>{!e||n.has(e)||(n.add(e),t.push(e))};for(let t of e)t.kind===`step_status`&&r(t.body.assigned_to),t.kind===`handoff`&&r(t.body.assigned_to??t.author),t.kind===`review`&&r(t.body.assigned_to??t.author),t.kind===`consult`&&(r(t.body.from),r(t.body.to)),t.kind===`assignment`&&r(t.body.pic);return t}var Z=s(),Fe={idle:`Đang chờ`,assigned:`Đã nhận việc`,working:`Đang làm`,done:`Vừa hoàn thành`};function Ie({agentIds:e,desks:t}){return(0,Z.jsxs)(`section`,{className:`office-3d-scene`,children:[(0,Z.jsx)(`h2`,{children:`Văn phòng 3D`}),(0,Z.jsx)(`p`,{className:`ops-chat-hint`,children:`Chế độ bảng (thu gọn hoạt ảnh) — cùng dữ liệu trạng thái nhân sự, hiển thị dạng bảng thay vì sơ đồ 3D.`}),e.length===0?(0,Z.jsx)(`p`,{className:`ops-chat-empty`,children:`Chưa có nhân sự nào xuất hiện trong dòng sự kiện.`}):(0,Z.jsxs)(`table`,{className:`office-3d-fallback-table`,children:[(0,Z.jsx)(`thead`,{children:(0,Z.jsxs)(`tr`,{children:[(0,Z.jsx)(`th`,{children:`Nhân sự`}),(0,Z.jsx)(`th`,{children:`Trạng thái`}),(0,Z.jsx)(`th`,{children:`Công việc`}),(0,Z.jsx)(`th`,{children:`Bước`})]})}),(0,Z.jsx)(`tbody`,{children:e.map(e=>{let n=t.get(e),r=n?.state??`idle`;return(0,Z.jsxs)(`tr`,{children:[(0,Z.jsx)(`td`,{"data-label":`Nhân sự`,children:e}),(0,Z.jsx)(`td`,{"data-label":`Trạng thái`,children:(0,Z.jsx)(`span`,{className:`office-3d-state office-3d-state-${r}`,children:Fe[r]})}),(0,Z.jsx)(`td`,{"data-label":`Công việc`,children:n?.taskTitle??`—`}),(0,Z.jsx)(`td`,{"data-label":`Bước`,children:n?.stepTitle??`—`})]},e)})})]})]})}var Le={idle:`#9aa0a6`,assigned:`#2f6bd8`,working:`#d97706`,done:`#188a4c`},Re=`#2b2b2b`,ze=[`#d94848`,`#2f6bd8`,`#188a4c`,`#b0529f`,`#d97706`,`#0e8f8f`,`#7a5cd6`,`#946200`];function Be(e){let t=0;for(let n of e)t=t*31+n.charCodeAt(0)>>>0;return t}function Ve(e){return ze[Be(e)%ze.length]}var He=4;function Ue(e,t){if(t<=0)return[0,0,He];let n=e/t*Math.PI*2;return[Math.sin(n)*He,0,Math.cos(n)*He]}var We=.4;function Ge(e,t){return[e[0]+(t[0]-e[0])*We,e[1]+(t[1]-e[1])*We,e[2]+(t[2]-e[2])*We]}var Ke=[1,.5,.6],qe=[0,0,1.4],Je=[0,0,.55],Ye=2.5,Xe=.015,Ze=1.6;function Qe({id:e}){let t=Ve(e),n=Be(e)%3;return(0,Z.jsxs)(`group`,{children:[[-.08,.08].map(e=>(0,Z.jsxs)(`mesh`,{position:[e,.11,0],children:[(0,Z.jsx)(`boxGeometry`,{args:[.09,.22,.11]}),(0,Z.jsx)(`meshBasicMaterial`,{color:t,transparent:!0,opacity:.14}),(0,Z.jsx)(X,{color:t,lineWidth:1.4})]},e)),(0,Z.jsxs)(`mesh`,{position:[0,.42,0],children:[(0,Z.jsx)(`boxGeometry`,{args:[.3,.4,.2]}),(0,Z.jsx)(`meshBasicMaterial`,{color:t,transparent:!0,opacity:.14}),(0,Z.jsx)(X,{color:t,lineWidth:1.8})]}),[-.2,.2].map(e=>(0,Z.jsxs)(`mesh`,{position:[e,.42,0],children:[(0,Z.jsx)(`boxGeometry`,{args:[.08,.34,.1]}),(0,Z.jsx)(`meshBasicMaterial`,{color:t,transparent:!0,opacity:.14}),(0,Z.jsx)(X,{color:t,lineWidth:1.4})]},e)),(0,Z.jsxs)(`mesh`,{position:[0,.76,0],children:[(0,Z.jsx)(`sphereGeometry`,{args:[.13,10,8]}),(0,Z.jsx)(`meshBasicMaterial`,{color:t,transparent:!0,opacity:.14}),(0,Z.jsx)(X,{color:t,lineWidth:1.2})]}),n===0&&(0,Z.jsxs)(`mesh`,{position:[0,.92,0],children:[(0,Z.jsx)(`coneGeometry`,{args:[.19,.14,8]}),(0,Z.jsx)(`meshBasicMaterial`,{color:t,transparent:!0,opacity:.2}),(0,Z.jsx)(X,{color:t,lineWidth:1.4})]}),n===1&&(0,Z.jsxs)(`mesh`,{position:[0,.78,.12],children:[(0,Z.jsx)(`boxGeometry`,{args:[.26,.06,.04]}),(0,Z.jsx)(`meshBasicMaterial`,{color:t,transparent:!0,opacity:.4}),(0,Z.jsx)(X,{color:t,lineWidth:1.4})]}),n===2&&(0,Z.jsxs)(`mesh`,{position:[0,.48,.11],children:[(0,Z.jsx)(`boxGeometry`,{args:[.07,.2,.02]}),(0,Z.jsx)(`meshBasicMaterial`,{color:t,transparent:!0,opacity:.5}),(0,Z.jsx)(X,{color:t,lineWidth:1.2})]})]})}function $e({position:e,label:t,desk:n,consultPos:r}){let i=(0,Y.useRef)(null),a=(0,Y.useRef)(null),o=Be(t)%7,s=n.state===`assigned`||n.state===`working`||n.state===`done`?Je:qe,c=r?Ge(e,r):[e[0]+s[0],e[1]+s[1],e[2]+s[2]];O((e,t)=>{let n=i.current;if(!n)return;let s=Math.min(1,t*Ye);n.position.x+=(c[0]-n.position.x)*s,n.position.y+=(c[1]-n.position.y)*s,n.position.z+=(c[2]-n.position.z)*s;let l=a.current;l&&(l.position.y=Xe*Math.sin(e.clock.elapsedTime*Ze+o));let[u,d]=r?[r[0],r[2]]:[0,0],f=Math.atan2(u-n.position.x,d-n.position.z)-n.rotation.y,p=Math.atan2(Math.sin(f),Math.cos(f));n.rotation.y+=p*s});let l=Le[n.state],u=[e[0],e[1]+1.6,e[2]];return(0,Z.jsxs)(`group`,{children:[(0,Z.jsx)(`group`,{position:e,children:(0,Z.jsxs)(`mesh`,{position:[0,.25,0],children:[(0,Z.jsx)(`boxGeometry`,{args:Ke}),(0,Z.jsx)(`meshBasicMaterial`,{color:`#ffffff`,transparent:!0,opacity:.55}),(0,Z.jsx)(X,{color:l,lineWidth:n.state===`done`?3:1.5})]})}),(0,Z.jsx)(`group`,{ref:i,position:[e[0]+qe[0],e[1]+qe[1],e[2]+qe[2]],children:(0,Z.jsx)(`group`,{ref:a,children:(0,Z.jsx)(Qe,{id:t})})}),(0,Z.jsx)(C,{position:[e[0],e[1]+1.1,e[2]],center:!0,distanceFactor:10,occlude:!1,children:(0,Z.jsxs)(`div`,{className:`office-3d-label`,style:{color:Ve(t)},children:[n.picTasks.size>0?`⭐ `:``,t]})}),(0,Z.jsx)(A,{position:u,taskTitle:n.taskTitle,stepTitle:n.stepTitle,phase:n.phase,consultWith:n.consultWith,isPic:n.picTasks.size>0})]})}var et=[1.4,.6,.8];function tt(){return(0,Z.jsxs)(`group`,{position:[0,.3,0],children:[(0,Z.jsxs)(`mesh`,{children:[(0,Z.jsx)(`boxGeometry`,{args:et}),(0,Z.jsx)(`meshBasicMaterial`,{color:`#ffffff`,transparent:!0,opacity:.55}),(0,Z.jsx)(X,{color:Re,lineWidth:2})]}),(0,Z.jsxs)(`mesh`,{position:[0,.5,-.15],children:[(0,Z.jsx)(`boxGeometry`,{args:[.55,.35,.05]}),(0,Z.jsx)(`meshBasicMaterial`,{color:Re,transparent:!0,opacity:.12}),(0,Z.jsx)(X,{color:Re,lineWidth:1.5})]}),(0,Z.jsx)(C,{position:[0,1,0],center:!0,distanceFactor:10,occlude:!1,children:(0,Z.jsx)(`div`,{className:`office-3d-label office-3d-label-coordinator`,children:`trưởng phòng`})})]})}var nt=[16,.05,12],rt=`#bdbdbd`;function it(){return(0,Z.jsxs)(`group`,{children:[(0,Z.jsxs)(`mesh`,{position:[0,-.05,0],children:[(0,Z.jsx)(`boxGeometry`,{args:nt}),(0,Z.jsx)(`meshBasicMaterial`,{color:`#ffffff`,transparent:!0,opacity:0}),(0,Z.jsx)(X,{color:rt,lineWidth:1})]}),(0,Z.jsx)(`gridHelper`,{args:[16,16,`#d6d6d6`,`#e7e7e7`],position:[0,0,0]})]})}var at=`#b07050`,ot=`#4c9a5f`,st=`#8a8a8a`,Q=`#5b7fb4`,$=`#c9a34e`;function ct({position:e}){return(0,Z.jsxs)(`group`,{position:e,children:[(0,Z.jsxs)(`mesh`,{position:[0,.2,0],children:[(0,Z.jsx)(`cylinderGeometry`,{args:[.22,.16,.4,8]}),(0,Z.jsx)(`meshBasicMaterial`,{color:at,transparent:!0,opacity:.2}),(0,Z.jsx)(X,{color:at,lineWidth:1.2})]}),(0,Z.jsxs)(`mesh`,{position:[0,.62,0],children:[(0,Z.jsx)(`sphereGeometry`,{args:[.3,8,6]}),(0,Z.jsx)(`meshBasicMaterial`,{color:ot,transparent:!0,opacity:.16}),(0,Z.jsx)(X,{color:ot,lineWidth:1.2})]}),(0,Z.jsxs)(`mesh`,{position:[0,.95,0],children:[(0,Z.jsx)(`coneGeometry`,{args:[.2,.35,7]}),(0,Z.jsx)(`meshBasicMaterial`,{color:ot,transparent:!0,opacity:.16}),(0,Z.jsx)(X,{color:ot,lineWidth:1.2})]})]})}function lt({position:e}){return(0,Z.jsxs)(`group`,{position:e,children:[[-.8,.8].map(e=>(0,Z.jsxs)(`mesh`,{position:[e,.55,0],children:[(0,Z.jsx)(`boxGeometry`,{args:[.06,1.1,.06]}),(0,Z.jsx)(`meshBasicMaterial`,{color:st,transparent:!0,opacity:.3}),(0,Z.jsx)(X,{color:st,lineWidth:1.2})]},e)),(0,Z.jsxs)(`mesh`,{position:[0,1.15,0],children:[(0,Z.jsx)(`boxGeometry`,{args:[2,1.1,.05]}),(0,Z.jsx)(`meshBasicMaterial`,{color:`#ffffff`,transparent:!0,opacity:.75}),(0,Z.jsx)(X,{color:st,lineWidth:1.6})]}),[.35,.15,-.05].map((e,t)=>(0,Z.jsxs)(`mesh`,{position:[-.25+t*.1,1.15+e,.035],children:[(0,Z.jsx)(`boxGeometry`,{args:[1.1-t*.3,.03,.01]}),(0,Z.jsx)(`meshBasicMaterial`,{color:st,transparent:!0,opacity:.8})]},e))]})}function ut({position:e,rotationY:t}){return(0,Z.jsxs)(`group`,{position:e,rotation:[0,t,0],children:[(0,Z.jsxs)(`mesh`,{position:[0,.22,0],children:[(0,Z.jsx)(`boxGeometry`,{args:[1.8,.35,.7]}),(0,Z.jsx)(`meshBasicMaterial`,{color:Q,transparent:!0,opacity:.16}),(0,Z.jsx)(X,{color:Q,lineWidth:1.4})]}),(0,Z.jsxs)(`mesh`,{position:[0,.62,-.28],children:[(0,Z.jsx)(`boxGeometry`,{args:[1.8,.5,.14]}),(0,Z.jsx)(`meshBasicMaterial`,{color:Q,transparent:!0,opacity:.16}),(0,Z.jsx)(X,{color:Q,lineWidth:1.4})]}),[-.85,.85].map(e=>(0,Z.jsxs)(`mesh`,{position:[e,.45,0],children:[(0,Z.jsx)(`boxGeometry`,{args:[.12,.35,.7]}),(0,Z.jsx)(`meshBasicMaterial`,{color:Q,transparent:!0,opacity:.16}),(0,Z.jsx)(X,{color:Q,lineWidth:1.2})]},e))]})}function dt({position:e}){return(0,Z.jsxs)(`group`,{position:e,children:[(0,Z.jsxs)(`mesh`,{position:[0,.7,0],children:[(0,Z.jsx)(`cylinderGeometry`,{args:[.03,.03,1.4,6]}),(0,Z.jsx)(`meshBasicMaterial`,{color:$,transparent:!0,opacity:.4}),(0,Z.jsx)(X,{color:$,lineWidth:1.2})]}),(0,Z.jsxs)(`mesh`,{position:[0,1.5,0],children:[(0,Z.jsx)(`coneGeometry`,{args:[.28,.3,8,1,!0]}),(0,Z.jsx)(`meshBasicMaterial`,{color:$,transparent:!0,opacity:.25}),(0,Z.jsx)(X,{color:$,lineWidth:1.4})]}),(0,Z.jsxs)(`mesh`,{position:[0,.02,0],children:[(0,Z.jsx)(`cylinderGeometry`,{args:[.25,.25,.05,8]}),(0,Z.jsx)(`meshBasicMaterial`,{color:$,transparent:!0,opacity:.3}),(0,Z.jsx)(X,{color:$,lineWidth:1.2})]})]})}function ft(){return(0,Z.jsxs)(`group`,{children:[(0,Z.jsx)(ct,{position:[-7,0,-5]}),(0,Z.jsx)(ct,{position:[7,0,4.6]}),(0,Z.jsx)(lt,{position:[-4.5,0,-5.6]}),(0,Z.jsx)(ut,{position:[6.6,0,-3.6],rotationY:-Math.PI/2}),(0,Z.jsx)(dt,{position:[7.2,0,-5.2]})]})}function pt({agentIds:e,desks:t}){return(0,Z.jsx)(`div`,{className:`office-3d-canvas-wrap`,children:(0,Z.jsxs)(g,{camera:{position:[0,6,10],fov:50},children:[(0,Z.jsx)(`color`,{attach:`background`,args:[`#fafafa`]}),(0,Z.jsx)(`ambientLight`,{intensity:.6}),(0,Z.jsx)(`directionalLight`,{position:[5,8,5],intensity:.8}),(0,Z.jsx)(it,{}),(0,Z.jsx)(ft,{}),(0,Z.jsx)(tt,{}),e.map((n,r)=>{let i=t.get(n);if(!i)return null;let a=i.consultWith?e.indexOf(i.consultWith):-1,o=a>=0?Ue(a,e.length):null;return(0,Z.jsx)($e,{position:Ue(r,e.length),label:n,desk:i,consultPos:o},n)}),(0,Z.jsx)(je,{enablePan:!1,minDistance:4,maxDistance:20,autoRotate:!0,autoRotateSpeed:.5})]})})}var mt=/Android|iPhone|iPad|iPod|Mobile/i;function ht(){return typeof window>`u`||!window.matchMedia?!1:window.matchMedia(`(prefers-reduced-motion: reduce)`).matches}function gt(){return typeof navigator>`u`?!1:mt.test(navigator.userAgent)}function _t(){return ht()||gt()}function vt(){let[e,t]=(0,Y.useState)(_t);return(0,Y.useEffect)(()=>{if(typeof window>`u`||!window.matchMedia)return;let e=window.matchMedia(`(prefers-reduced-motion: reduce)`),n=()=>t(_t());return e.addEventListener(`change`,n),()=>e.removeEventListener(`change`,n)},[]),e}function yt({messages:e,connected:t,errored:n}){let r=(0,Y.useRef)(null),i=e.slice(-40);return(0,Y.useEffect)(()=>{let e=r.current;e&&(e.scrollTop=e.scrollHeight)},[e.length]),(0,Z.jsxs)(`aside`,{className:`office-unified-feed`,"aria-label":`Hoạt động trực tiếp`,children:[(0,Z.jsx)(`p`,{className:`office-room-status`,children:n?`Mất kết nối luồng — thử tải lại trang.`:t?`Hoạt động trực tiếp`:`Đang kết nối…`}),i.length===0&&!n&&(0,Z.jsx)(`p`,{className:`ops-chat-empty`,children:`Chưa có hoạt động nào.`}),(0,Z.jsx)(`ul`,{className:`office-room-log office-unified-log`,ref:r,children:i.map(e=>(0,Z.jsxs)(`li`,{className:`office-room-entry office-room-${e.kind}`,children:[(0,Z.jsx)(`span`,{className:`office-room-kind`,children:te[e.kind]??e.kind}),(0,Z.jsx)(`span`,{className:`office-room-author`,children:e.author}),(0,Z.jsx)(`p`,{className:`office-room-text`,children:ee(e)})]},e.seq))})]})}function bt(e,t){let n=/^@([A-Za-z0-9_.-]*)$/.exec(e.trimStart().split(/\s/,1)[0]??``);if(!n||/\s/.test(e.trimStart()))return[];let r=n[1].toLowerCase(),i=[{id:`all`,domain:`đội tự chọn PIC`},...t];if(!r)return i;let a=i.filter(e=>e.id.toLowerCase().startsWith(r)),o=i.filter(e=>!e.id.toLowerCase().startsWith(r)&&e.id.toLowerCase().includes(r));return[...a,...o]}function xt(){let[e,t]=(0,Y.useState)(``),[n,r]=(0,Y.useState)([]),[i,a]=(0,Y.useState)({kind:`idle`}),o=(0,Y.useRef)(!1),s=()=>{o.current||(o.current=!0,f.getAssignableStaff().then(e=>r(e.staff)).catch(()=>r([])))},c=bt(e,n),l=e=>{t(`@${e} `)},u=()=>{i.kind!==`preview`&&(!e.trim()||i.kind===`previewing`||i.kind===`confirming`||(a({kind:`previewing`}),f.assignPreview(e.trim()).then(e=>{e.auto_confirmed?(a({kind:`done`,text:e.preview_text,auto:!0}),t(``)):a({kind:`preview`,data:e})}).catch(e=>a({kind:`error`,message:e instanceof Error?e.message:`giao việc thất bại`}))))},d=e=>{i.kind===`preview`&&(a({kind:`confirming`}),f.assignConfirm(e.task_id,e.plan_hash).then(e=>{a({kind:`done`,text:e.text,auto:!1}),t(``)}).catch(e=>a({kind:`error`,message:e instanceof Error?e.message:`xác nhận thất bại`})))},p=e=>{f.assignCancel(e.task_id).catch(()=>void 0),a({kind:`idle`})};return(0,Z.jsxs)(`div`,{className:`office-composer`,children:[(0,Z.jsxs)(`div`,{className:`office-composer-row`,children:[(0,Z.jsx)(`input`,{type:`text`,value:e,placeholder:`Giao việc… (@tên-nhân-sự để chỉ định PIC, @all hoặc bỏ trống để đội tự chọn)`,onFocus:s,onChange:e=>{t(e.target.value),(i.kind===`error`||i.kind===`done`)&&a({kind:`idle`})},onKeyDown:e=>{e.key===`Enter`&&u()}}),(0,Z.jsx)(`button`,{type:`button`,onClick:u,disabled:i.kind===`previewing`,children:i.kind===`previewing`?`Đang lập kế hoạch…`:`Giao việc`})]}),c.length>0&&(0,Z.jsx)(`ul`,{className:`office-composer-mentions`,role:`listbox`,children:c.map(e=>(0,Z.jsx)(`li`,{children:(0,Z.jsxs)(`button`,{type:`button`,onClick:()=>l(e.id),children:[`@`,e.id,` `,(0,Z.jsxs)(`span`,{className:`office-composer-domain`,children:[`(`,e.domain,`)`]})]})},e.id))}),i.kind===`preview`&&(0,Z.jsxs)(`div`,{className:`office-composer-preview`,children:[(0,Z.jsx)(`pre`,{children:i.data.preview_text}),(0,Z.jsxs)(`div`,{className:`office-composer-actions`,children:[(0,Z.jsx)(`button`,{type:`button`,className:`primary`,onClick:()=>d(i.data),children:`Xác nhận giao việc`}),(0,Z.jsx)(`button`,{type:`button`,onClick:()=>p(i.data),children:`Huỷ`})]})]}),i.kind===`confirming`&&(0,Z.jsx)(`p`,{className:`office-room-status`,children:`Đang xác nhận…`}),i.kind===`done`&&(0,Z.jsxs)(`div`,{className:`office-composer-preview office-composer-done`,children:[(0,Z.jsx)(`pre`,{children:i.text}),i.auto&&(0,Z.jsx)(`p`,{className:`office-room-status`,children:`Đã tự xác nhận (chế độ tự xác nhận đang bật).`})]}),i.kind===`error`&&(0,Z.jsxs)(`p`,{className:`error`,children:[`Lỗi: `,i.message]})]})}var St=`office`;function Ct(){let{messages:e,connected:t,errored:n}=o(St),r=vt(),i=(0,Y.useMemo)(()=>Pe(e),[e]),a=(0,Y.useMemo)(()=>Ne(e),[e]);return(0,Z.jsxs)(`section`,{className:`office-unified`,children:[(0,Z.jsx)(`h2`,{children:`Văn phòng`}),(0,Z.jsxs)(`p`,{className:`ops-chat-hint`,children:[`Toàn cảnh đội đang làm việc + hoạt động trực tiếp. Giao việc ngay bên dưới: gõ `,(0,Z.jsx)(`code`,{children:`@tên-nhân-sự`}),` để chỉ định người chịu trách nhiệm chính (PIC), hoặc `,(0,Z.jsx)(`code`,{children:`@all`}),`/bỏ trống để đội tự chọn.`]}),(0,Z.jsxs)(`div`,{className:`office-unified-layout`,children:[(0,Z.jsx)(`div`,{className:`office-unified-main`,children:r?(0,Z.jsx)(Ie,{agentIds:i,desks:a}):(0,Z.jsx)(pt,{agentIds:i,desks:a})}),(0,Z.jsx)(yt,{messages:e,connected:t,errored:n})]}),(0,Z.jsx)(xt,{})]})}export{Ct as OfficeUnified,Ct as default};