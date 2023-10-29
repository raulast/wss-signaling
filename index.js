require('dotenv').config()
const path = require('path')
const express = require('express')
const cors = require('cors')
const { uuid } = require('uuidv4');
const ws = require('ws');
const router= express.Router()
const app = express()
const TTTwss = new ws.Server({ noServer: true });
const port = 8080;
const TTTsocks = new Map();
const sendMessage = (sock,msg,type="signal")=>{
  if(sock.readyState === ws.OPEN){
    sock.send(JSON.stringify({type,msg}))
    return true;
  }
  return false;
}
const procesarPayload = (socket,p)=>{
  const {
    type,
    from,
    send_to,
    msg
  } = p;
  let sock = null;
  switch (type) {
    case "register":
      const session_id = uuid()
      TTTsocks.set(session_id,{ws:socket});
      sendMessage(socket,{session_id:session_id},type)
      break;
    case "destroy":
      if(!TTTsocks.has(from)){
        sendMessage(socket,`El usuario #${from} no esta conectado`,"console.error")
        break;
      }
      sock = TTTsocks.get(from);
      if(sock.ws === socket){
        socket.close();
        TTTsocks.clear(from);
      }
      break;
    case "echo":
      sendMessage(socket,msg,"console.log")
      break;
    case "direct":
      if(!TTTsocks.has(send_to)){
        sendMessage(socket,`El usuario #${send_to} no esta conectado`,"console.error")
        break;
      }
      sock = TTTsocks.get(send_to);
      if(sock.ws !== socket){
        sendMessage(sock.ws,msg)
      }
      break;
    case "broadcast":
      const sessions = []
      for (const [session,{ws}] of TTTsocks.entries()) {
        if(ws === socket) continue;
        const valid = sendMessage(ws,msg,type)
        if (valid) {
          sessions.push({
            session
          })
        }
      }
      sendMessage(socket,{sessions},"broadcast.result")
      break;
    default:
      break;
  }
}

TTTwss.on('connection', socket => {
  socket.on('error', console.error);
  socket.on('message', (message,plain) => {
    const msg = plain?message:message.toString()
    try {
      console.log(msg);
      const payload = JSON.parse(msg)
      procesarPayload(socket,
        {
          ...{
            type:"",
            from:"",
            send_to:"",
            msg:""
          },
          ...payload
        }
      );
    } catch (error) {
      console.log(error);
      sendMessage(socket,"hubo un error del lado del signal server","console.error")
    }
  });
});

router.get('/', function (req, res, next) {
  res.json({msg: 'hola crack'})
})
app.use(cors())
app.use('/',express.static(path.join(__dirname, 'public')))
app.use('/api',router)
const server = app.listen(port, function () {
  console.log('CORS-enabled web server listening on port '+ port)
})
server.on('upgrade', (request, socket, head) => {
  const pathname = request.url;
  if (pathname === '/tic-tac-toe') {
    TTTwss.handleUpgrade(request, socket, head, function done(ws) {
      TTTwss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});