const peersEl = document.getElementById("peers");
const msgsEl = document.getElementById("msgs");
const msgBufferInputEl = document.getElementById("msgBuffer");
const mySessionId = ()=>(localStorage.getItem("mySessionId"))

// para efectos del ejemplo
const peers = new Map();
window.peers = peers;
function show(msg) {
  const newMsgEl = document.createElement("div");
  newMsgEl.innerText = msg;
  msgsEl?.appendChild(newMsgEl);
}
msgBufferInputEl.onkeydown = (ev) => {
  if (ev.key === "Enter") {
    const msg = msgBufferInputEl.value;
    msgBufferInputEl.value = "";
    show(msg);
    for (const [sessionId, {dataChannel}] of peers.entries()) {
      if (dataChannel === void 0) {
        console.warn(`Could not send to ${sessionId}; no data channel`);
        continue;
      }
      try {
        dataChannel.send(msg);
      } catch (err) {
        console.error(`Error sending to ${sessionId}: ${err}`);
      }
    }
  }
};
function showPeers() {
  peersEl.innerText = [...peers.keys()].join(" || ");
}

// para efectos de la libreria 
// const peers = new Map();

//send message to a peer
function sendToPeer(sessionId,msg) {
  if(!peers.has(sessionId))return;
  const {dataChannel} = peers.get(sessionId);
  if (dataChannel === void 0) {
    console.warn(`Could not send to ${sessionId}; no data channel`);
  }
  try {
    dataChannel.send(msg);
  } catch (err) {
    console.error(`Error sending to ${sessionId}: ${err}`);
  }
}

const clientWs = {};
// notify to signal server
function publishSignalingMsg(toSessionId, signalingMsg) {
  console.log("Sending to", toSessionId, ":", JSON.stringify(signalingMsg));
  clientWs.ws.send(JSON.stringify({
    type:"direct",
    from:mySessionId(),
    send_to:toSessionId,
    msg:signalingMsg
  }))
}

// create and conect peers
function newPeerConnection() {
  return new RTCPeerConnection({iceServers: [
    {urls: [
      "stun:stun.l.google.com:19302",
      "stun:stun1.l.google.com:19302",
      "stun:stun2.l.google.com:19302",
      "stun:stun3.l.google.com:19302",
      "stun:stun4.l.google.com:19302"
    ]}]}
  );
}
function newPeer(sessionId) {
  if (peers.has(sessionId)) {
    throw new Error(`Error: we already have a peer with sessionId ${sessionId}`);
  }
  const peerConn = newPeerConnection();
  peerConn.onconnectionstatechange = (ev) => {
    console.log("State of connection to ", sessionId, ":", peerConn.connectionState);
    if (peerConn.connectionState === "closed" || peerConn.connectionState === "disconnected" || peerConn.connectionState === "failed") {
      console.log(`Cleaning up ${sessionId}`);
      peers.delete(sessionId);
      showPeers();
    }
  };
  peerConn.onicecandidate = (ev) => {
    if (ev.candidate !== null) {
      publishSignalingMsg(sessionId, {
        kind: "ice-candidate",
        fromSessionId: mySessionId(),
        candidate: ev.candidate
      });
    }
  };
  const peer = {id: sessionId, peerConn, iceCandidateBuffer: [], dataChannel: void 0};
  peers.set(sessionId, peer);
  showPeers();
  return peer;
}
function setUpDataChannel(dataChannel, peer) {
  peer.dataChannel = dataChannel;
  dataChannel.onmessage = (msgEv) => show(`${peer.id} says: ${msgEv.data}`);
}
async function handleHello(remoteSessionId) {
  if (remoteSessionId === mySessionId())
    return;
  if (peers.has(remoteSessionId)) {
    throw new Error("Received hello from existing peer!");
  }
  console.log("Received hello from", remoteSessionId);
  const peer = newPeer(remoteSessionId);
  setUpDataChannel(peer.peerConn.createDataChannel("myDataChannel"), peer);
  const desc = await peer.peerConn.createOffer();
  await peer.peerConn.setLocalDescription(desc);
  publishSignalingMsg(remoteSessionId, {
    kind: "offer",
    fromSessionId: mySessionId(),
    offer: desc
  });
}
function getOrCreatePeer(remoteSessionId) {
  return peers.get(remoteSessionId) || newPeer(remoteSessionId);
}
async function setRemoteDescription(peer, description) {
  await peer.peerConn.setRemoteDescription(description);
  if (!peer.peerConn.remoteDescription) {
    throw new Error("remoteDescription not set after setting");
  }
  for (const candidate of peer.iceCandidateBuffer) {
    await peer.peerConn.addIceCandidate(candidate);
  }
  peer.iceCandidateBuffer = [];
}
async function handleSignalingMsgOffer(signalingMsgOffer) {
  if (signalingMsgOffer.fromSessionId === mySessionId())
    return;
  const fromSessionId = signalingMsgOffer.fromSessionId;
  console.log("Received offer from", fromSessionId);
  const peer = getOrCreatePeer(fromSessionId);
  if (peer.peerConn.remoteDescription) {
    console.warn("Received a second offer from the same peer", peer);
  }
  peer.peerConn.ondatachannel = (dataChannelEv) => {
    setUpDataChannel(dataChannelEv.channel, peer);
  };
  await setRemoteDescription(peer, signalingMsgOffer.offer);
  const answerDesc = await peer.peerConn.createAnswer();
  await peer.peerConn.setLocalDescription(answerDesc);
  publishSignalingMsg(signalingMsgOffer.fromSessionId, {
    kind: "answer",
    fromSessionId: mySessionId(),
    answer: answerDesc
  });
}
async function handleSignalingMsgAnswer(signalingMsgAnswer) {
  if (signalingMsgAnswer.fromSessionId === mySessionId())
    return;
  const fromSessionId = signalingMsgAnswer.fromSessionId;
  console.log("Received answer from", fromSessionId);
  const peer = peers.get(fromSessionId);
  if (peer === void 0) {
    throw new Error("Unexpected answer from a peer we never sent an offer to!");
  }
  if (peer.peerConn.remoteDescription) {
    console.warn("Received a second offer from the same peer", peer);
  }
  console.log("Setting answer");
  await setRemoteDescription(peer, signalingMsgAnswer.answer);
}
async function handleSignalingMsgIceCandidate(signalingMsgIceCandidate) {
  if (signalingMsgIceCandidate.fromSessionId === mySessionId())
    return;
  const fromSessionId = signalingMsgIceCandidate.fromSessionId;
  console.log("Received ICE candidate from", fromSessionId);
  const peer = getOrCreatePeer(fromSessionId);
  if (peer.peerConn.remoteDescription) {
    await peer.peerConn.addIceCandidate(signalingMsgIceCandidate.candidate);
  } else {
    peer.iceCandidateBuffer.push(signalingMsgIceCandidate.candidate);
  }
}

function procesarHandles(msg) {
  const {kind} = msg;
  switch (kind) {
    case "offer":
        handleSignalingMsgOffer(msg)
      break;
    case "answer":
        handleSignalingMsgAnswer(msg)
      break;
    case "ice-candidate":
        handleSignalingMsgIceCandidate(msg)
      break;
    default:
        console.log("@procesarHandles",msg)
      break;
  }  
}

function start(url) {
  const ws = new WebSocket(url);
  ws.onmessage = ({data})=>{
    const { type, msg } = JSON.parse(data);
    switch (type) {
      case "signal":
          procesarHandles(msg);
        break;
      case "register":
          localStorage.setItem("mySessionId",msg.session_id)
          ws.send(JSON.stringify({
            type:"broadcast",
            from:msg.session_id,
            msg:msg.session_id
          }))
        break;
      case "console.error":
          console.error("@ws_console.error",msg)
        break;
      case "console.log":
          console.log("@ws_console.log",msg)
        break;
      case "broadcast":
          handleHello(msg)
        break;
      case "broadcast.result":
          clientWs.sessions = msg.sessions;
        break;
      default:
          console.log(msg);
        break;
    }
  }
  ws.onerror = (e)=>{
    console.error("@ws_onerror",e);
  }
  ws.onopen = (e)=>{
    console.log("@ws_onopen",e);
    clientWs.ws = ws;
    ws.send(JSON.stringify({
      type:"register"
    }))
  }
  ws.onclose = (e)=>{
    console.log("@ws_onclose",e)
  }
}
window.start = (p)=>{
  start(p)
}

// window.handleHello = (msg)=>{
//   handleHello(msg);
// };
// window.handleSignalingMsgOffer = (msg)=>{
//   handleSignalingMsgOffer(msg);
// };
// window.handleSignalingMsgAnswer = (msg)=>{
//   handleSignalingMsgAnswer(msg);
// };
// window.handleSignalingMsgIceCandidate = (msg)=>{
//   handleSignalingMsgIceCandidate(msg);
// };