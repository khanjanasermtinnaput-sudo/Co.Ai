// Dev-only: rasterize the TAOTAO pixel geometry to a PNG to eyeball the sprite.
// Ports the same geometry used by taotao-sprite.tsx. Not shipped at runtime.
import zlib from "node:zlib";
import fs from "node:fs";

const PAL = {
  fur: "#8A93A8", furLight: "#B9C1D2", furDark: "#5C6477", furShadow: "#454C5C",
  outline: "#262B36", earPink: "#E59AB0", eye: "#F4AE3C", eyeDark: "#C9852A",
  pupil: "#23262E", shine: "#FFFFFF", nose: "#F2A0B5", mouth: "#3A3F4A",
  collar: "#8B5CF6", collarDark: "#6D3FD4", tag: "#D9DEEA", tagDark: "#9AA2B5",
  tagGold: "#F4C95B", blush: "#EC9AB0",
};
const hex = (h) => [parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];

const K=(x,y)=>x+","+y;
const dedupe=(ps)=>{const s=new Set();const o=[];for(const p of ps){const k=K(p.x,p.y);if(!s.has(k)){s.add(k);o.push(p);}}return o;};
const rect=(x0,y0,w,h)=>{const o=[];for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)o.push({x,y});return o;};
const ellipse=(cx,cy,rx,ry)=>{const o=[];for(let y=Math.floor(cy-ry);y<=Math.ceil(cy+ry);y++)for(let x=Math.floor(cx-rx);x<=Math.ceil(cx+rx);x++){const dx=(x+0.5-cx)/(rx+0.5),dy=(y+0.5-cy)/(ry+0.5);if(dx*dx+dy*dy<=1)o.push({x,y});}return o;};
const circle=(cx,cy,r)=>ellipse(cx,cy,r,r);
const triangle=(a,b,c)=>{const minX=Math.floor(Math.min(a.x,b.x,c.x)),maxX=Math.ceil(Math.max(a.x,b.x,c.x)),minY=Math.floor(Math.min(a.y,b.y,c.y)),maxY=Math.ceil(Math.max(a.y,b.y,c.y));const sign=(p1,p2,px,py)=>(px-p2.x)*(p1.y-p2.y)-(p1.x-p2.x)*(py-p2.y);const o=[];for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++){const px=x+0.5,py=y+0.5,d1=sign(a,b,px,py),d2=sign(b,c,px,py),d3=sign(c,a,px,py);const neg=d1<0||d2<0||d3<0,pos=d1>0||d2>0||d3>0;if(!(neg&&pos))o.push({x,y});}return o;};
const union=(...s)=>dedupe(s.flat());
const outline=(ps)=>{const f=new Set(ps.map(p=>K(p.x,p.y)));const o=[];const seen=new Set();for(const p of ps)for(const[dx,dy]of[[1,0],[-1,0],[0,1],[0,-1]]){const x=p.x+dx,y=p.y+dy,k=K(x,y);if(f.has(k)||seen.has(k))continue;seen.add(k);o.push({x,y});}return o;};
const subtract=(a,b)=>{const r=new Set(b.map(p=>K(p.x,p.y)));return a.filter(p=>!r.has(K(p.x,p.y)));};
const intersect=(a,m)=>{const k=new Set(m.map(p=>K(p.x,p.y)));return a.filter(p=>k.has(K(p.x,p.y)));};

const head=ellipse(16,12,9,7), cheekL=circle(8,15,3.2), cheekR=circle(24,15,3.2), torso=ellipse(16,26,8.5,6);
const earOuterL=triangle({x:5,y:8},{x:11,y:8},{x:7,y:1}), earOuterR=triangle({x:21,y:8},{x:27,y:8},{x:25,y:1});
const earInnerL=triangle({x:7,y:7},{x:10,y:7},{x:8,y:3}), earInnerR=triangle({x:22,y:7},{x:25,y:7},{x:24,y:3});
const bodyNoEars=union(head,cheekL,cheekR,torso), ears=union(earOuterL,earOuterR), silhouette=union(bodyNoEars,ears);
const bodyOutline=outline(bodyNoEars), earOutline=outline(ears);
const foreheadLight=intersect(bodyNoEars,ellipse(16,6,4,2)), bellyLight=intersect(bodyNoEars,ellipse(16,27,4.5,2.5)), muzzleLight=intersect(bodyNoEars,ellipse(16,16,5,2));
const bottomShade=subtract(intersect(bodyNoEars,ellipse(16,30,7,2)),bellyLight);
const sideShade=subtract(intersect(bodyNoEars,union(ellipse(8,17,2,3),ellipse(24,17,2,3))),union(foreheadLight,muzzleLight));
const collarBand=intersect(silhouette,rect(8,18,16,2)), collarShade=intersect(silhouette,rect(8,19,16,1));
const tagPlate=[{x:15,y:20},{x:16,y:20},{x:15,y:21},{x:16,y:21}];
const tailFill=[{x:24,y:28},{x:25,y:27},{x:26,y:26},{x:27,y:25},{x:27,y:24},{x:26,y:23},{x:25,y:23},{x:24,y:24}];
const tailOutline=subtract(outline(tailFill),bodyNoEars);
const paws=union(rect(11,30,4,2),rect(17,30,4,2)); const pawToes=[{x:12,y:31},{x:19,y:31}];

const EYE_L=11, EYE_R=19;
function eyeParts(shape,ex){const e={eye:[],pupil:[],shine:[],dark:[],lid:[]};
 if(shape==="open")return{...e,eye:rect(ex,10,3,4),dark:rect(ex,13,3,1),pupil:rect(ex+1,10,1,3),shine:[{x:ex,y:10}]};
 if(shape==="wide")return{...e,eye:rect(ex,9,3,5),dark:rect(ex,13,3,1),pupil:rect(ex+1,10,1,3),shine:[{x:ex,y:9}]};
 if(shape==="focused")return{...e,eye:rect(ex,11,3,2),pupil:rect(ex+1,11,1,2),shine:[{x:ex,y:11}]};
 if(shape==="sleepy")return{...e,lid:rect(ex,11,3,1),eye:rect(ex,12,3,1),pupil:[{x:ex+1,y:12}]};
 if(shape==="sad")return{...e,eye:rect(ex,11,3,3),dark:rect(ex,13,3,1),pupil:rect(ex+1,12,1,2),shine:[{x:ex,y:11}]};
 if(shape==="happy"||shape==="wink")return{...e,pupil:[{x:ex,y:12},{x:ex+1,y:11},{x:ex+2,y:12}]};
 if(shape==="blink")return{...e,pupil:rect(ex,12,3,1)};
 return e;}
function mouth(s){if(s==="neutral")return[{x:15,y:16},{x:16,y:16}];if(s==="smile")return[{x:14,y:16},{x:15,y:17},{x:16,y:17},{x:17,y:16}];if(s==="bigSmile")return[{x:13,y:16},{x:14,y:17},{x:15,y:18},{x:16,y:18},{x:17,y:17},{x:18,y:16}];if(s==="open")return rect(15,16,2,2);return[{x:14,y:17},{x:15,y:16},{x:16,y:16},{x:17,y:17}];}
const nose=[{x:15,y:15},{x:16,y:15}];

const EMO={happy:{eyes:"happy",mouth:"smile",blush:1},success:{eyes:"wink",mouth:"bigSmile",blush:1},sad:{eyes:"sad",mouth:"frown"},coding:{eyes:"focused",mouth:"neutral",brow:1},curious:{eyes:"wide",mouth:"open",browRaise:1},sleepy:{eyes:"sleepy",mouth:"neutral"},neutral:{eyes:"open",mouth:"neutral"}};

function compose(emotion){
 const expr=EMO[emotion];
 const grid={}; // key -> hex
 const paint=(ps,c)=>{for(const p of ps)grid[K(p.x,p.y)]=PAL[c]||c;};
 paint(tailOutline,"outline"); paint(tailFill,"fur"); paint([{x:26,y:24}],"furLight");
 paint(bodyOutline,"outline"); paint(bodyNoEars,"fur");
 paint(sideShade,"furShadow"); paint(bottomShade,"furDark");
 paint(foreheadLight,"furLight"); paint(muzzleLight,"furLight"); paint(bellyLight,"furLight");
 paint(outline(paws),"outline"); paint(paws,"furLight"); paint(pawToes,"furShadow");
 paint(collarBand,"collar"); paint(collarShade,"collarDark");
 paint(outline(tagPlate),"collarDark"); paint(tagPlate,"tag"); paint([{x:15,y:20}],"tagGold");
 paint(earOutline,"outline"); paint(ears,"fur"); paint(union(earInnerL,earInnerR),"earPink");
 // face
 if(expr.blush)paint([{x:9,y:16},{x:10,y:16},{x:21,y:16},{x:22,y:16}],"blush");
 const lShape=expr.eyes==="wink"?"open":expr.eyes, rShape=expr.eyes==="wink"?"happy":expr.eyes;
 const L=eyeParts(lShape,EYE_L), R=eyeParts(rShape,EYE_R);
 paint([...L.lid,...R.lid],"furDark"); paint([...L.eye,...R.eye],"eye");
 paint([...L.dark,...R.dark],"eyeDark"); paint([...L.pupil,...R.pupil],"pupil"); paint([...L.shine,...R.shine],"shine");
 if(expr.brow)paint([{x:11,y:9},{x:12,y:9},{x:13,y:10},{x:18,y:10},{x:19,y:9},{x:20,y:9}],"mouth");
 if(expr.browRaise)paint(union(rect(11,8,3,1),rect(18,8,3,1)),"mouth");
 paint(nose,"nose"); paint(mouth(expr.mouth),"mouth");
 return grid;
}

// rasterize: 32x32 grid -> scaled RGBA -> PNG
function png(grids){
 const N=32, S=14, GAP=8, cols=grids.length;
 const W=cols*N*S+(cols+1)*GAP, H=N*S+2*GAP;
 const buf=Buffer.alloc(W*H*4);
 const bg=hex("#0A0F1E");
 for(let i=0;i<W*H;i++){buf[i*4]=bg[0];buf[i*4+1]=bg[1];buf[i*4+2]=bg[2];buf[i*4+3]=255;}
 grids.forEach((g,gi)=>{
  const ox=GAP+gi*(N*S+GAP);
  for(const [k,c] of Object.entries(g)){const[gx,gy]=k.split(",").map(Number);const[r,gg,b]=hex(c);
   for(let dy=0;dy<S;dy++)for(let dx=0;dx<S;dx++){const X=ox+gx*S+dx,Y=GAP+gy*S+dy;if(X<0||Y<0||X>=W||Y>=H)continue;const o=(Y*W+X)*4;buf[o]=r;buf[o+1]=gg;buf[o+2]=b;buf[o+3]=255;}}
  });
 // encode PNG (truecolor+alpha)
 const raw=Buffer.alloc((W*4+1)*H);
 for(let y=0;y<H;y++){raw[y*(W*4+1)]=0;buf.copy(raw,y*(W*4+1)+1,y*W*4,(y+1)*W*4);}
 const idat=zlib.deflateSync(raw);
 const crcTable=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;crcTable[n]=c>>>0;}
 const crc=(b)=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
 const chunk=(type,data)=>{const len=Buffer.alloc(4);len.writeUInt32BE(data.length);const t=Buffer.from(type);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(Buffer.concat([t,data])));return Buffer.concat([len,t,data,cr]);};
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ihdr),chunk("IDAT",idat),chunk("IEND",Buffer.alloc(0))]);
}

const emotions=["neutral","happy","success","curious","coding","sleepy","sad"];
fs.writeFileSync("/tmp/taotao.png", png(emotions.map(compose)));
console.log("wrote /tmp/taotao.png", emotions.join(", "));

// ── Mock in-chat scenes: cat(s) sitting on the input box ────────────────────
function encodePng(buf,W,H){
 const raw=Buffer.alloc((W*4+1)*H);
 for(let y=0;y<H;y++){raw[y*(W*4+1)]=0;buf.copy(raw,y*(W*4+1)+1,y*W*4,(y+1)*W*4);}
 const idat=zlib.deflateSync(raw);
 const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xedb88320^(c>>>1):c>>>1;t[n]=c>>>0;}
 const crc=(b)=>{let c=0xffffffff;for(const x of b)c=t[(c^x)&0xff]^(c>>>8);return(c^0xffffffff)>>>0;};
 const chunk=(ty,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const tt=Buffer.from(ty);const cr=Buffer.alloc(4);cr.writeUInt32BE(crc(Buffer.concat([tt,d])));return Buffer.concat([l,tt,d,cr]);};
 const ih=Buffer.alloc(13);ih.writeUInt32BE(W,0);ih.writeUInt32BE(H,4);ih[8]=8;ih[9]=6;
 return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",ih),chunk("IDAT",idat),chunk("IEND",Buffer.alloc(0))]);
}
function px(buf,W,H,x,y,c){x|=0;y|=0;if(x<0||y<0||x>=W||y>=H)return;const o=(y*W+x)*4;buf[o]=c[0];buf[o+1]=c[1];buf[o+2]=c[2];buf[o+3]=255;}
function fillRect(buf,W,H,x0,y0,w,h,c){for(let y=y0;y<y0+h;y++)for(let x=x0;x<x0+w;x++)px(buf,W,H,x,y,c);}
function blit(buf,W,H,grid,ox,oy,S,flip){for(const[k,col]of Object.entries(grid)){let[gx,gy]=k.split(",").map(Number);if(flip)gx=31-gx;const c=hex(col);for(let dy=0;dy<S;dy++)for(let dx=0;dx<S;dx++)px(buf,W,H,ox+gx*S+dx,oy+gy*S+dy,c);}}
function yarn(buf,W,H,cx,cy,S){const g={"1,2":"#ef4444","0,3":"#ef4444","1,5":"#ef4444","2,1":"#f87171","2,6":"#dc2626","2,3":"#b91c1c","5,2":"#b91c1c","3,2":"#fca5a5"};for(const[k,col]of Object.entries(g)){const[gx,gy]=k.split(",").map(Number);const c=hex(col);for(let dy=0;dy<S;dy++)for(let dx=0;dx<S;dx++)px(buf,W,H,cx+gx*S+dx,cy+gy*S+dy,c);}fillRect(buf,W,H,cx+0*S,cy+3*S,8*S,2*S,hex("#ef4444"));}
function scene(buf,W,H,y0,kind){
 const boxTop=y0+150, S=4, catH=32*S;
 fillRect(buf,W,H,140,boxTop,W-280,70,hex("#111317"));
 fillRect(buf,W,H,140,boxTop,W-280,2,hex("#2a2f3a"));
 fillRect(buf,W,H,140,boxTop+68,W-280,2,hex("#15181f"));
 fillRect(buf,W,H,W-188,boxTop+18,34,34,hex("#D97706"));
 const feet=boxTop-catH+10;
 if(kind==="waiting")blit(buf,W,H,compose("happy"),(W-catH)/2,feet,S,false);
 if(kind==="processing"){blit(buf,W,H,compose("curious"),200,feet,S,false);blit(buf,W,H,compose("curious"),W-200-catH,feet,S,true);yarn(buf,W,H,(W-32)/2-30,feet-30,4);}
 if(kind==="quota"){blit(buf,W,H,compose("sad"),(W-catH)/2-30,feet,S,false);const bx=(W+catH)/2-30,by=boxTop-26;fillRect(buf,W,H,bx,by,70,8,hex("#1f2430"));fillRect(buf,W,H,bx+4,by+6,62,14,hex("#3b82f6"));fillRect(buf,W,H,bx+8,by+6,54,5,hex("#1f2430"));}
}
const SW=820,SH=250,kinds=["waiting","processing","quota"];
const CW=SW,CH=SH*kinds.length;
const cbuf=Buffer.alloc(CW*CH*4);for(let i=0;i<CW*CH;i++){cbuf[i*4]=10;cbuf[i*4+1]=12;cbuf[i*4+2]=20;cbuf[i*4+3]=255;}
kinds.forEach((k,i)=>scene(cbuf,CW,CH,i*SH,k));
fs.writeFileSync("/tmp/taotao-chat.png", encodePng(cbuf,CW,CH));
console.log("wrote /tmp/taotao-chat.png", kinds.join(", "));
