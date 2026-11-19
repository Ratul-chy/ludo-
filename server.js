const http=require('http'),fs=require('fs'),path=require('path'),{WebSocketServer}=require('ws');
const START=[0,13,26,39],SAFE=new Set([0,8,13,21,26,34,39,47]),ORDER=[0,1,2,3],NAMES=['Red','Green','Yellow','Blue'],rooms={};
const server=http.createServer((q,r)=>{if(q.url==='/health')return r.end('ok');r.writeHead(200,{'Content-Type':'text/html; charset=utf-8'});r.end(fs.readFileSync(path.join(__dirname,'index.html')));});
const wss=new WebSocketServer({server});
const legal=(t,i,d)=>t[i]<0?d===6:t[i]+d<=56;

function nextTurn(rm){
  const on=rm.players.filter(p=>p.online).map(p=>p.seat).sort((a,b)=>a-b);
  if(!on.length){rm.turn=-1;rm.phase='roll';return;}
  const cur=on.indexOf(rm.turn);
  rm.turn=on[(cur+1)%on.length];
  rm.phase='roll';rm.sixes=0;
}

function view(rm,p){
  return{
    code:rm.code,you:p.seat,host:rm.players[0]===p,seq:rm.seq,
    players:rm.players.map(x=>({seat:x.seat,name:x.name,online:x.online})),
    started:rm.started,turn:rm.turn,dice:rm.dice,phase:rm.phase,
    tokens:rm.tokens,winner:rm.winner,log:rm.log,
    movable:rm.started&&rm.phase==='move'&&rm.turn===p.seat
      ?[0,1,2,3].filter(i=>legal(rm.tokens[rm.turn],i,rm.dice)):[]
  };
}
function send(rm){rm.seq++;rm.players.forEach(p=>p.online&&p.ws&&p.ws.readyState===1&&p.ws.send(JSON.stringify(view(rm,p))));}

wss.on('connection',ws=>{
  ws.on('message',raw=>{
    let m;try{m=JSON.parse(raw)}catch{return}
    if(m.t==='ping')return;

    if(m.t==='join'){
      const code=String(m.room||'').toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,8);
      if(!code)return;
      const rm=rooms[code]??={code,seq:0,players:[],started:false,turn:0,dice:0,phase:'roll',sixes:0,tokens:{},winner:null,log:''};
      let p=rm.players.find(x=>x.pid===m.pid);
      if(p){p.ws=ws;p.online=true;}
      else{
        if(rm.started&&rm.winner==null)return ws.send(JSON.stringify({err:'Game already started'}));
        if(rm.players.length>=4)return ws.send(JSON.stringify({err:'Room is full (4 players max)'}));
        const seat=ORDER.find(s=>!rm.players.some(x=>x.seat===s));
        if(seat===undefined)return ws.send(JSON.stringify({err:'Room is full'}));
        p={pid:m.pid,seat,name:String(m.name||'Player').slice(0,12),ws,online:true};
        rm.players.push(p);
      }
      ws.ctx={rm,p};
      return send(rm);
    }

    const c=ws.ctx;if(!c)return;const{rm,p}=c;

    if(m.t==='start'&&rm.players[0]===p&&rm.players.length>1&&(!rm.started||rm.winner!=null)){
      rm.tokens={};rm.players.forEach(x=>rm.tokens[x.seat]=[-1,-1,-1,-1]);
      rm.started=true;rm.winner=null;
      rm.turn=Math.min(...rm.players.map(x=>x.seat));
      rm.phase='roll';rm.sixes=0;rm.dice=0;rm.log='Game started!';
      return send(rm);
    }

    if(!rm.started||rm.winner!=null||rm.turn!==p.seat)return;
    const t=rm.tokens[p.seat];

    if(m.t==='roll'&&rm.phase==='roll'){
      const d=1+Math.floor(Math.random()*6);rm.dice=d;
      rm.sixes=d===6?rm.sixes+1:0;
      if(rm.sixes===3){rm.log=`${p.name} rolled three 6s — turn lost`;nextTurn(rm);}
      else if(![0,1,2,3].some(i=>legal(t,i,d))){rm.log=`${p.name} rolled ${d} — no move`;nextTurn(rm);}
      else{rm.phase='move';rm.log=`${p.name} rolled ${d}`;}
      return send(rm);
    }

    if(m.t==='move'&&rm.phase==='move'){
      const i=m.i,d=rm.dice;
      if(!(i>=0&&i<4)||!legal(t,i,d))return;
      const from=t[i];
      const to=from<0?0:from+d;
      t[i]=to;
      let cap=false;
      if(to<=50){
        const a=(START[p.seat]+to)%52;
        if(!SAFE.has(a))for(const o of rm.players)if(o.seat!==p.seat)
          rm.tokens[o.seat].forEach((q,k)=>{
            if(q>=0&&q<=50&&(START[o.seat]+q)%52===a){rm.tokens[o.seat][k]=-1;cap=true;}
          });
      }
      if(t.every(x=>x===56)){rm.winner=p.seat;rm.log=`🏆 ${p.name} (${NAMES[p.seat]}) wins!`;}
      else if(d===6||cap||to===56){rm.phase='roll';rm.log=`${p.name} ${cap?'captured a token':to===56?'got a token home':'rolled a 6'} — roll again`;}
      else nextTurn(rm);
      return send(rm);
    }
  });

  ws.on('close',()=>{
    const c=ws.ctx;if(!c||c.p.ws!==ws)return;
    const{rm,p}=c;
    p.online=false;
    if(rm.started&&rm.winner==null&&rm.turn===p.seat)nextTurn(rm);
    send(rm);
    setTimeout(()=>{if(!rm.players.some(x=>x.online))delete rooms[rm.code];},36e5);
  });
});
server.listen(process.env.PORT||3000,()=>console.log('Ludo running on '+(process.env.PORT||3000)));