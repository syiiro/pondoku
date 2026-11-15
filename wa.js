// Tier 3: WhatsApp automation via whatsapp-web.js. Use a dedicated number; scan the QR once (session kept by LocalAuth).
let client=null,ready=false,qr=null,H=null,Poll=null;
const digits=p=>{let d=String(p||'').replace(/\D/g,'');if(d.startsWith('0'))d='6'+d;return d};
const memberByPhone=(g,jid)=>g.members.map(H.byId).find(u=>u&&digits(u.answers.phone)===String(jid).split('@')[0]);
exports.init=h=>{H=h};
exports.status=()=>({started:!!client,ready,qr:!!qr});
exports.start=()=>{if(client)return;let W;
 try{W=require('whatsapp-web.js')}catch{return console.log('Tier 3 needs: npm i whatsapp-web.js qrcode-terminal')}
 Poll=W.Poll;client=new W.Client({authStrategy:new W.LocalAuth(),puppeteer: {
    ...(process.platform === 'win32' ? { executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' } : {}),
    args: ['--no-sandbox', '--disable-setuid-sandbox']
}});
 client.on('qr',q=>{qr=q;try{require('qrcode-terminal').generate(q,{small:true})}catch{console.log(q)}});
 client.on('ready',()=>{ready=true;qr=null;console.log('WhatsApp connected')});
 client.on('disconnected',()=>{ready=false;client=null});
 // A parent joined via their link -> record it; join() posts the pinned welcome once >=3 have joined
 client.on('group_join',n=>{const g=H.db.groups.find(x=>x.waId===n.chatId);if(!g)return;
  for(const jid of n.recipientIds||[]){const u=memberByPhone(g,jid);if(u)H.join(g,u.id)}H.save()});
 // Consent poll answers -> votes (only an anonymous tally is ever shown)
 client.on('vote_update',async v=>{const p=H.db.polls.find(x=>!x.done&&x.waMsgId===v.parentMessage?.id?._serialized);if(!p)return;
  const g=H.db.groups.find(x=>x.id===p.groupId),u=memberByPhone(g,v.voter),o=v.selectedOptions?.[0]?.name;if(!u)return;
  if(o)p.votes[u.id]=o==='Yes';else delete p.votes[u.id];await H.resolvePoll(p);H.save()});
 client.initialize().catch(e=>{console.error(e);client=null})};
const chatOf=g=>client.getChatById(g.waId);
exports.createAndInvite=async g=>{if(!ready)throw new Error('WhatsApp not connected');
 const r=await client.createGroup(g.name+' · Pondoku',[]);g.waId=r.gid._serialized;
 for(const uid of g.members)await exports.dmInvite(g,H.byId(uid));H.save()};
exports.dmInvite=async(g,u)=>{if(!ready||!g.waId)return;
 const url='https://chat.whatsapp.com/'+await(await chatOf(g)).getInviteCode(),bm=u.answers.lang==='bm';
 const text=bm?`Hai ${u.answers.name}, Pondoku menemui kumpulan keluarga berhampiran anda. Menyertai ialah pilihan anda. Pautan: ${url}`:`Hi ${u.answers.name}, Pondoku found a group of families near you. Joining is your choice. Link: ${url}`;
 const id=await client.getNumberId(digits(u.answers.phone));if(id)await client.sendMessage(id._serialized,text);
 g.invites[u.id]={url,sent:true,at:Date.now()};await H.mail(u,'Pondoku: your private group link',text);H.save()};
exports.postWelcome=async g=>{const m=await(await chatOf(g)).sendMessage(g.welcomeText);try{await m.pin(2592000)}catch(e){console.log('pin failed',e.message)}};
exports.postText=async(g,t)=>{if(ready&&g.waId)await(await chatOf(g)).sendMessage(t)};
exports.postPoll=async p=>{const g=H.db.groups.find(x=>x.id===p.groupId);if(!ready||!g?.waId||!Poll)return;
 const m=await(await chatOf(g)).sendMessage(new Poll(`A new family would like to join: child aged ${p.info.age}, about ${p.info.km} km away, group match ${p.info.score}%. Welcome them?`,['Yes','No'],{allowMultipleAnswers:false}));
 p.waMsgId=m.id._serialized;H.save()};
