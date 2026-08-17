(()=>{
  const cfg = window.FILTER_CONFIG;
  const filters = Array.isArray(window.FILTERS) ? window.FILTERS : [];
  const canvas = document.getElementById('editorCanvas');
  const ctx = canvas?.getContext('2d');
  if (!cfg || !canvas || !ctx) return;

  const csrf = document.querySelector('meta[name="csrf-token"]')?.content || '';
  const input = document.getElementById('photoInput');
  const hint = document.getElementById('stageHint');
  const choosePhoto = document.getElementById('choosePhoto');
  const openCamera = document.getElementById('openCamera');
  const controls = document.getElementById('liveControls');
  const doneState = document.getElementById('doneState');
  const finishPhoto = document.getElementById('finishPhoto');
  const downloadPhoto = document.getElementById('downloadPhoto');
  const makeAnother = document.getElementById('makeAnother');
  const zoomIn = document.getElementById('zoomIn');
  const zoomOut = document.getElementById('zoomOut');
  const prev = document.getElementById('filterPrev');
  const next = document.getElementById('filterNext');
  const filterName = document.getElementById('filterName');
  const filterChoice = document.getElementById('filterChoice');
  const withFilterBtn = document.getElementById('withFilter');
  const withoutFilterBtn = document.getElementById('withoutFilter');

  const cameraModal = document.getElementById('cameraModal');
  const cameraVideo = document.getElementById('cameraVideo');
  const cameraCanvas = document.getElementById('cameraCanvas');
  const cameraCtx = cameraCanvas?.getContext('2d');
  const cameraLoading = document.getElementById('cameraLoading');
  const cameraStatus = document.getElementById('cameraStatus');
  const faceDot = document.getElementById('faceDot');
  const faceMessage = document.getElementById('faceMessage');
  const captureCamera = document.getElementById('captureCamera');
  const closeCamera = document.getElementById('closeCamera');
  const cancelCamera = document.getElementById('cancelCamera');

  let activeIndex = Math.max(0, filters.findIndex(f => Number(f.id) === Number(cfg.id)));
  let activeFilter = filters[activeIndex] || {id: cfg.id, name: cfg.name, overlay: cfg.overlay};
  let overlay = new Image();
  overlay.crossOrigin = 'anonymous';
  let photo = null;
  let submission = null;
  let scale = 1;
  let minScale = 1;
  let x = 0;
  let y = 0;
  let drag = false;
  let last = {x:0,y:0};
  let pointers = new Map();
  let pinchDistance = 0;

  let cameraStream = null;
  let cameraRAF = 0;
  let faceLandmarker = null;
  let lastVideoTime = -1;
  let lastLandmarks = null;
  let cameraStarting = false;
  let cameraCapture = false;
  let includeCampaignFilter = true;
  const glasses = new Image();
  glasses.crossOrigin = 'anonymous';
  glasses.src = cfg.glasses;

  async function readJson(res, fallbackMessage){
    const text=await res.text();
    let data={};
    try{ data=text ? JSON.parse(text) : {}; }
    catch(_err){
      const message = res.status === 502 || res.status === 503 || res.status === 504
        ? 'O servidor demorou para responder. Tente novamente em alguns segundos.'
        : fallbackMessage;
      throw new Error(message);
    }
    if(!res.ok) throw new Error(data.error||fallbackMessage);
    return data;
  }

  function event(type){
    fetch('/api/events', {method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':csrf},body:JSON.stringify({type,filter_id:activeFilter.id})}).catch(()=>{});
  }

  function loadOverlay(){
    const nextOverlay = new Image();
    nextOverlay.crossOrigin = 'anonymous';
    nextOverlay.onload = () => { overlay = nextOverlay; draw(); };
    nextOverlay.src = activeFilter.overlay;
    if (filterName) filterName.textContent = activeFilter.name;
  }

  function draw(){
    ctx.clearRect(0,0,1080,1080);
    ctx.fillStyle='#fff';
    ctx.fillRect(0,0,1080,1080);
    if(photo) ctx.drawImage(photo,x,y,photo.naturalWidth*scale,photo.naturalHeight*scale);
    if(includeCampaignFilter && overlay.complete && overlay.naturalWidth) ctx.drawImage(overlay,0,0,1080,1080);
  }

  function resetPosition(){
    if(!photo) return;
    minScale=Math.max(1080/photo.naturalWidth,1080/photo.naturalHeight);
    scale=minScale;
    x=(1080-photo.naturalWidth*scale)/2;
    y=(1080-photo.naturalHeight*scale)/2;
    draw();
  }

  function clamp(){
    if(!photo) return;
    const w=photo.naturalWidth*scale,h=photo.naturalHeight*scale;
    x=Math.min(0,Math.max(1080-w,x));
    y=Math.min(0,Math.max(1080-h,y));
  }

  function pointerPos(e){
    const r=canvas.getBoundingClientRect();
    return {x:(e.clientX-r.left)*1080/r.width,y:(e.clientY-r.top)*1080/r.height};
  }

  function zoomBy(factor, center={x:540,y:540}){
    if(!photo) return;
    const old=scale;
    const max=minScale*3.2;
    scale=Math.max(minScale,Math.min(max,scale*factor));
    if(scale===old) return;
    x=center.x-(center.x-x)*(scale/old);
    y=center.y-(center.y-y)*(scale/old);
    clamp();
    draw();
  }

  function switchFilter(direction){
    if(filters.length<2) return;
    activeIndex=(activeIndex+direction+filters.length)%filters.length;
    activeFilter=filters[activeIndex];
    loadOverlay();
  }

  function setHintLoading(){
    hint.innerHTML='<div class="upload-spinner"></div><b>Preparando sua foto...</b><small>Isso leva só alguns segundos</small>';
    hint.classList.add('is-loading');
  }

  function restoreHint(){
    hint.classList.remove('is-loading');
    hint.innerHTML='<div class="stage-upload-icon">↑</div><b>Crie sua foto de apoio</b><small>Envie uma foto ou use a câmera frontal com o óculos Duso.</small><div class="source-actions"><button type="button" class="source-btn source-upload" id="choosePhoto"><span>▣</span> Escolher foto</button><button type="button" class="source-btn source-camera" id="openCamera"><span>◉</span> Usar câmera</button></div><em>JPG, PNG ou WEBP • até 15 MB</em>';
    hint.querySelector('#choosePhoto')?.addEventListener('click',()=>input.click());
    hint.querySelector('#openCamera')?.addEventListener('click',startCamera);
  }

  async function handleFile(file, options={}){
    if(!file) return;
    setHintLoading();
    cameraCapture=Boolean(options.cameraCapture);
    includeCampaignFilter=true;
    const fd=new FormData();
    fd.append('filter_id',activeFilter.id);
    fd.append('photo',file,file.name || 'foto-duso.jpg');
    try{
      event('upload_click');
      const res=await fetch('/api/upload',{method:'POST',headers:{'X-CSRFToken':csrf},body:fd});
      const data=await readJson(res,'Não foi possível enviar a foto. Tente novamente.');
      submission=data;
      photo=new Image();
      photo.onload=()=>{
        hint.hidden=true;
        controls.hidden=false;
        doneState.hidden=true;
        resetPosition();
        syncFilterChoice();
      };
      photo.src=data.photo_url;
    }catch(err){
      alert(err.message);
      hint.hidden=false;
      restoreHint();
    }
  }

  choosePhoto?.addEventListener('click',()=>input.click());
  openCamera?.addEventListener('click',startCamera);
  input?.addEventListener('change',e=>handleFile(e.target.files[0]));
  zoomIn?.addEventListener('click',()=>zoomBy(1.12));
  zoomOut?.addEventListener('click',()=>zoomBy(1/1.12));
  prev?.addEventListener('click',()=>switchFilter(-1));
  next?.addEventListener('click',()=>switchFilter(1));

  canvas.addEventListener('wheel',e=>{
    if(!photo) return;
    e.preventDefault();
    zoomBy(e.deltaY<0?1.08:1/1.08,pointerPos(e));
  },{passive:false});

  canvas.addEventListener('pointerdown',e=>{
    if(!photo) return;
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId,pointerPos(e));
    if(pointers.size===1){drag=true;last=pointerPos(e)}
    if(pointers.size===2){
      const [a,b]=[...pointers.values()];
      pinchDistance=Math.hypot(a.x-b.x,a.y-b.y);
      drag=false;
    }
  });

  canvas.addEventListener('pointermove',e=>{
    if(!photo||!pointers.has(e.pointerId)) return;
    const p=pointerPos(e);
    pointers.set(e.pointerId,p);
    if(pointers.size===2){
      const [a,b]=[...pointers.values()];
      const dist=Math.hypot(a.x-b.x,a.y-b.y);
      if(pinchDistance>0){
        const center={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
        zoomBy(dist/pinchDistance,center);
      }
      pinchDistance=dist;
      return;
    }
    if(drag){
      x+=p.x-last.x;y+=p.y-last.y;last=p;clamp();draw();
    }
  });

  function releasePointer(e){
    pointers.delete(e.pointerId);
    if(pointers.size===0){drag=false;pinchDistance=0}
    else if(pointers.size===1){drag=true;last=[...pointers.values()][0]}
  }
  canvas.addEventListener('pointerup',releasePointer);
  canvas.addEventListener('pointercancel',releasePointer);

  finishPhoto?.addEventListener('click',async()=>{
    if(!photo||!submission) return;
    finishPhoto.textContent='Finalizando...';
    finishPhoto.disabled=true;
    try{
      const res=await fetch(`/api/complete/${submission.submission_id}`,{method:'POST',headers:{'Content-Type':'application/json','X-CSRFToken':csrf},body:JSON.stringify({token:submission.token,filter_id:activeFilter.id,include_overlay:includeCampaignFilter,transform:{x,y,scale}})});
      const data=await readJson(res,'Não foi possível finalizar a imagem. Tente novamente.');
      downloadPhoto.href=data.download_url;
      controls.hidden=true;
      doneState.hidden=false;
    }catch(e){alert(e.message)}finally{
      finishPhoto.textContent='Finalizar foto';
      finishPhoto.disabled=false;
    }
  });

  function syncFilterChoice(){
    if(!filterChoice) return;
    filterChoice.hidden=!cameraCapture;
    withFilterBtn?.classList.toggle('active',includeCampaignFilter);
    withoutFilterBtn?.classList.toggle('active',!includeCampaignFilter);
  }

  withFilterBtn?.addEventListener('click',()=>{includeCampaignFilter=true;syncFilterChoice();draw()});
  withoutFilterBtn?.addEventListener('click',()=>{includeCampaignFilter=false;syncFilterChoice();draw()});

  makeAnother?.addEventListener('click',()=>{
    photo=null;submission=null;input.value='';cameraCapture=false;includeCampaignFilter=true;
    controls.hidden=true;doneState.hidden=true;hint.hidden=false;
    restoreHint();
    draw();
  });

  async function ensureFaceLandmarker(){
    if(faceLandmarker) return faceLandmarker;
    cameraStatus.textContent='Carregando reconhecimento facial…';
    const mp = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs');
    const vision = await mp.FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm');
    const options={
      baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task',delegate:'GPU'},
      runningMode:'VIDEO',numFaces:1,minFaceDetectionConfidence:.55,minFacePresenceConfidence:.55,minTrackingConfidence:.55
    };
    try{
      faceLandmarker = await mp.FaceLandmarker.createFromOptions(vision,options);
    }catch(_gpuError){
      options.baseOptions.delegate='CPU';
      faceLandmarker = await mp.FaceLandmarker.createFromOptions(vision,options);
    }
    return faceLandmarker;
  }

  async function startCamera(){
    if(cameraStarting || !cameraModal || !cameraCtx) return;
    cameraStarting=true;
    cameraModal.hidden=false;
    cameraModal.setAttribute('aria-hidden','false');
    document.body.classList.add('camera-open');
    cameraLoading.hidden=false;
    captureCamera.disabled=true;
    lastLandmarks=null;
    faceDot?.classList.remove('found');
    faceMessage.textContent='Centralize seu rosto para encaixar o óculos automaticamente.';
    try{
      if(!navigator.mediaDevices?.getUserMedia) throw new Error('Seu navegador não oferece acesso à câmera.');
      const [_,stream] = await Promise.all([
        ensureFaceLandmarker(),
        navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:1280}},audio:false})
      ]);
      cameraStream=stream;
      cameraVideo.srcObject=stream;
      await cameraVideo.play();
      fitCameraCanvas();
      cameraLoading.hidden=true;
      cameraStatus.textContent='Reconhecimento facial ativo';
      renderCamera();
    }catch(err){
      console.error(err);
      stopCamera();
      alert('Não foi possível abrir a câmera frontal. Verifique a permissão da câmera e tente novamente.');
    }finally{cameraStarting=false}
  }

  function sourceCrop(){
    const vw=cameraVideo.videoWidth||720, vh=cameraVideo.videoHeight||720;
    const side=Math.min(vw,vh);
    return {vw,vh,side,sx:(vw-side)/2,sy:(vh-side)/2};
  }

  function fitCameraCanvas(){
    if(!cameraCanvas) return;
    const dpr=Math.max(1,Math.min(window.devicePixelRatio||1,2));
    const wrap=cameraCanvas.parentElement;
    const rect=wrap?.getBoundingClientRect();
    if(!rect?.width || !rect?.height) return;
    const size=Math.max(rect.width,rect.height);
    cameraCanvas.width=Math.round(size*dpr);
    cameraCanvas.height=Math.round(size*dpr);
  }

  function mapLandmark(lm,size){
    const c=sourceCrop();
    const rawX=lm.x*c.vw, rawY=lm.y*c.vh;
    return {x:size-((rawX-c.sx)/c.side*size),y:(rawY-c.sy)/c.side*size};
  }

  function glassesPose(landmarks,size){
    if(!landmarks?.length) return null;
    const leftA=mapLandmark(landmarks[33],size), leftB=mapLandmark(landmarks[133],size);
    const rightA=mapLandmark(landmarks[362],size), rightB=mapLandmark(landmarks[263],size);
    const l={x:(leftA.x+leftB.x)/2,y:(leftA.y+leftB.y)/2};
    const r={x:(rightA.x+rightB.x)/2,y:(rightA.y+rightB.y)/2};
    const dx=r.x-l.x,dy=r.y-l.y;
    const eyeDistance=Math.hypot(dx,dy);
    if(!Number.isFinite(eyeDistance)||eyeDistance<20) return null;
    return {cx:(l.x+r.x)/2,cy:(l.y+r.y)/2+eyeDistance*.03,width:eyeDistance*2.45,angle:Math.atan2(dy,dx)};
  }

  function drawGlasses(targetCtx,pose){
    if(!pose || !glasses.complete || !glasses.naturalWidth) return;
    const ratio=glasses.naturalHeight/glasses.naturalWidth;
    const h=pose.width*ratio;
    targetCtx.save();
    targetCtx.translate(pose.cx,pose.cy);
    targetCtx.rotate(pose.angle);
    targetCtx.scale(-1,-1);
    targetCtx.drawImage(glasses,-pose.width/2,-h/2,pose.width,h);
    targetCtx.restore();
  }

  function renderCamera(){
    if(!cameraStream || !cameraVideo.videoWidth) return;
    const size=cameraCanvas.width || 720;
    const c=sourceCrop();
    cameraCtx.clearRect(0,0,size,size);
    cameraCtx.save();
    cameraCtx.translate(size,0); cameraCtx.scale(-1,1);
    cameraCtx.drawImage(cameraVideo,c.sx,c.sy,c.side,c.side,0,0,size,size);
    cameraCtx.restore();

    try{
      if(cameraVideo.currentTime!==lastVideoTime && faceLandmarker){
        const result=faceLandmarker.detectForVideo(cameraVideo,performance.now());
        lastVideoTime=cameraVideo.currentTime;
        lastLandmarks=result.faceLandmarks?.[0] || null;
      }
    }catch(err){console.warn('Face landmark frame skipped',err)}

    const pose=glassesPose(lastLandmarks,size);
    if(pose){
      drawGlasses(cameraCtx,pose);
      captureCamera.disabled=false;
      faceDot?.classList.add('found');
      faceMessage.textContent='Rosto encontrado. O óculos acompanha seus movimentos.';
    }else{
      captureCamera.disabled=true;
      faceDot?.classList.remove('found');
      faceMessage.textContent='Centralize seu rosto e olhe para a câmera.';
    }
    cameraRAF=requestAnimationFrame(renderCamera);
  }

  function releaseCameraStream(){
    if(cameraRAF) cancelAnimationFrame(cameraRAF);
    cameraRAF=0;
    cameraStream?.getTracks().forEach(t=>t.stop());
    cameraStream=null;
    if(cameraVideo) cameraVideo.srcObject=null;
    lastVideoTime=-1;
  }

  function stopCamera(){
    releaseCameraStream();
    if(cameraModal){cameraModal.hidden=true;cameraModal.setAttribute('aria-hidden','true')}
    document.body.classList.remove('camera-open');
    lastLandmarks=null;
    cameraLoading.hidden=false;
    cameraLoading.querySelector('b').textContent='Ativando câmera…';
    captureCamera.textContent='● Tirar foto';
    cameraStarting=false;
  }

  async function takeCameraPhoto(){
    if(!lastLandmarks || !cameraVideo.videoWidth || captureCamera.disabled) return;

    // Copia o último frame imediatamente e encerra a câmera antes de qualquer processamento pesado.
    const frozenLandmarks=lastLandmarks;
    const c=sourceCrop();
    const out=document.createElement('canvas');out.width=1080;out.height=1080;
    const o=out.getContext('2d',{alpha:false});
    o.save();o.translate(1080,0);o.scale(-1,1);o.drawImage(cameraVideo,c.sx,c.sy,c.side,c.side,0,0,1080,1080);o.restore();
    drawGlasses(o,glassesPose(frozenLandmarks,1080));

    captureCamera.disabled=true;
    releaseCameraStream();
    lastLandmarks=null;
    cameraLoading.hidden=false;
    cameraLoading.querySelector('b').textContent='Preparando sua foto…';
    cameraStatus.textContent='Foto capturada';

    // Fecha a câmera visualmente já; o processamento passa a aparecer no editor.
    cameraModal.hidden=true;
    cameraModal.setAttribute('aria-hidden','true');
    document.body.classList.remove('camera-open');
    setHintLoading();

    const blob=await new Promise(resolve=>out.toBlob(resolve,'image/jpeg',.90));
    captureCamera.textContent='● Tirar foto';
    captureCamera.disabled=false;
    cameraLoading.querySelector('b').textContent='Ativando câmera…';
    if(!blob){restoreHint();return alert('Não foi possível capturar a foto. Tente novamente.');}
    const file=new File([blob],'camera-duso.jpg',{type:'image/jpeg'});
    handleFile(file,{cameraCapture:true});
  }

  captureCamera?.addEventListener('click',takeCameraPhoto);
  closeCamera?.addEventListener('click',stopCamera);
  cancelCamera?.addEventListener('click',stopCamera);
  cameraModal?.addEventListener('click',e=>{if(e.target===cameraModal) stopCamera()});
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && cameraModal && !cameraModal.hidden) stopCamera()});
  window.addEventListener('pagehide',stopCamera);
  window.addEventListener('resize',()=>{if(cameraModal && !cameraModal.hidden) fitCameraCanvas()});

  loadOverlay();
  draw();
})();
