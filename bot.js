// bot.js — the Pondoku WhatsApp agent's "brain" (prototype).
//
// The whole flow:
//   1. A parent finishes the form on the website  -> start(u)
//   2. Bot DMs them the top 3 most compatible open groups (merit score)
//   3. Parent replies "1", "2" or "3"              -> onReply(u, text)
//   4. Bot posts a Yes/No poll in that group asking to accept the family
//   5. Group votes (server.js resolvePoll counts the votes):
//        all Yes -> approved(u, g)  -> parent gets the invite / is added
//        any No  -> declined(u, g)  -> parent is shown the other groups
//
// This file never talks to WhatsApp directly. It calls send()/askGroup(), which:
//   - always write into db.chats (so the simulator page /bot.html can show the chat)
//   - also send for real through wa.js when the Coordinator mode is "prod"

let H = null; // helpers handed over by server.js (db, score, km, join, ...)
exports.init = h => { H = h; };

const MAX = 5;        // a group is full at 5 families
const MIN_SCORE = 55; // every member must score at least this with the new family
const SHOW = 3;       // how many groups the bot offers at once

// ---------- chat log + sending ----------
function log(chat, from, text, extra = {}) {
  H.db.chats = H.db.chats || [];
  H.db.chats.push({ chat, from, text, at: Date.now(), ...extra });
  if (H.db.chats.length > 500) H.db.chats.splice(0, H.db.chats.length - 500);
}
async function send(u, text) { // bot -> one parent (private chat)
  log('dm:' + u.id, 'bot', text);
  if (H.db.mode === 'prod') await H.wa.sendDm(u, text).catch(e => console.error('WA DM failed:', e.message));
}
async function sayInGroup(g, text) { // bot -> a group chat (plain message)
  log('group:' + g.id, 'bot', text);
  if (H.db.mode === 'prod') await H.wa.postText(g, text).catch(e => console.error('WA group msg failed:', e.message));
}
async function askGroup(p, g) { // bot -> a group chat (Yes/No poll)
  log('group:' + g.id, 'bot', p.text, { pollId: p.id });
  if (H.db.mode === 'prod') await H.wa.postPoll(p).catch(e => console.error('WA poll failed:', e.message));
}

// ---------- the merit system: rank groups for one family ----------
function rankGroups(u) {
  const tried = u.bot?.rejectedBy || [];
  return H.db.groups
    .filter(g => g.members.length < MAX)              // has space
    .filter(g => !g.hold || g.hold === u.id)          // not busy voting on someone else
    .filter(g => !tried.includes(g.id))               // has not already said no to this family
    .filter(g => !g.members.includes(u.id))
    .map(g => {
      const ms = g.members.map(H.byId);
      const scores = ms.map(m => H.score(u.answers, m.answers));
      const dists = ms.map(m => H.km(u.answers, m.answers));
      return {
        g,
        avg: Math.round(scores.reduce((a, b) => a + b, 0) / scores.length), // average match with members
        worst: Math.min(...scores),                                         // weakest match in the group
        km: Math.round(Math.min(...dists)),                                 // nearest member
        size: ms.length,
        area: ms[0].answers.area,
      };
    })
    .filter(x => x.worst >= MIN_SCORE && x.km <= H.db.th.dist) // must fit everyone, and be near
    .sort((a, b) => b.avg - a.avg || a.km - b.km)              // best match first
    .slice(0, SHOW);
}

// ---------- step 2: offer groups ----------
async function offer(u, intro) {
  const list = rankGroups(u);
  u.bot.options = list.map(x => x.g.id);
  if (!list.length) {
    u.bot.state = 'nogroup';
    // Same fallback as before: try to start a brand-new group with other waiting families
    const cl = H.buildCluster(u, H.db.users.filter(x => x.status === 'Available' && x.id !== u.id));
    if (cl) {
      u.bot.state = 'done';
      H.makeGroup(cl);
      for (const m of cl) await send(m, `Good news ${m.answers.name}! There was no open group for you, so Pondoku started a new group with ${cl.length} nearby families like yours. Your group link will arrive shortly.`);
      return;
    }
    u.status = 'Available';
    await send(u, (intro ? intro + '\n\n' : '') +
      `I could not find an open group that fits your family right now. You stay on the waiting list, and the coordinator is told.\n\nReply *MENU* any time to check again.`);
    return;
  }
  u.bot.state = 'choosing';
  u.status = 'Available';
  const lines = list.map((x, i) =>
    `*${i + 1}. ${x.g.name}* — ${x.avg}% match\n   ${x.size} of ${MAX} families · nearest ${x.km < 1 ? 'under 1' : x.km} km · ${x.area}`);
  await send(u, (intro ? intro + '\n\n' : '') +
    `These groups fit your family best:\n\n${lines.join('\n\n')}\n\nReply with the *number* of the group you want to join (for example *1*).`);
}

// ---------- step 1: called by server.js when the website form is completed ----------
exports.start = async u => {
  u.bot = { state: 'choosing', options: [], rejectedBy: [] };
  await offer(u, `Hi ${u.answers.name}, I'm the Pondoku Helper 👋 Thanks for registering on the website.`);
};

// ---------- step 3: the parent replied in the private chat ----------
exports.onReply = async (u, text) => {
  log('dm:' + u.id, u.id, text);
  const t = String(text || '').trim().toLowerCase();
  if (!u.bot) return send(u, `Hi ${u.answers.name || ''}! Please finish the form on the Pondoku website first, then I will message you here.`);
  const s = u.bot.state;

  if (s === 'done') return send(u, `You are already matched with ${groupName(u.groupId)}. If you need help, contact the Pondoku coordinator.`);
  if (s === 'waiting') return send(u, `I am still waiting for ${groupName(u.bot.asked)} to answer. I will message you as soon as they do (at most 48 hours).`);
  if (['menu', 'groups', 'list', 'hi', 'hello'].includes(t)) return offer(u);

  if (s === 'choosing') {
    const n = parseInt(t, 10);
    const gid = u.bot.options[n - 1];
    if (!gid) return send(u, `Please reply with a number from 1 to ${u.bot.options.length}, or *MENU* to see the list again.`);
    return choose(u, H.db.groups.find(g => g.id === gid));
  }
  return send(u, `Reply *MENU* to see the groups that fit your family.`);
};

// ---------- step 4: ask the chosen group ----------
async function choose(u, g) {
  if (!g || g.members.length >= MAX || (g.hold && g.hold !== u.id))
    return offer(u, `Sorry, that group just became unavailable.`);
  const ms = g.members.map(H.byId);
  const range = ({ c: '7–12', t: '13–17', y: '18–25', a: '26+' })[u.answers.age] || '—';
  const p = {
    id: H.id('p'), groupId: g.id, userId: u.id, rule: 'unanimous', votes: {}, created: Date.now(),
    reminded: false, done: false, via: 'bot',
    info: {
      age: range,
      km: Math.round(Math.min(...ms.map(m => H.km(u.answers, m.answers)))),
      score: Math.round(Math.min(...ms.map(m => H.score(u.answers, m.answers)))),
    },
  };
  // Privacy: the group only sees age range, distance and match %, not the family's name.
  p.text = `A new family would like to join this group: child aged ${p.info.age}, ${p.info.km < 1 ? 'under 1' : 'about ' + p.info.km} km away, match ${p.info.score}%. Do you welcome them? (Everyone must vote Yes. No answer in 48 hours counts as No.)`;
  H.db.polls.push(p);
  g.hold = u.id;
  u.status = 'Pending Consent';
  u.bot.state = 'waiting';
  u.bot.asked = g.id;
  await askGroup(p, g);
  await send(u, `Great choice 👍 I have asked *${g.name}* if they are happy for your family to join. They have up to 48 hours. I will message you here with their answer.`);
}

// ---------- step 5a: group said yes (called from server.js resolvePoll) ----------
exports.approved = async (u, g) => {
  u.bot.state = 'done';
  if (H.db.mode === 'prod') {
    // wa.dmInvite (called by server.js) already sends the real invite link
    await send(u, `🎉 Good news! *${g.name}* said YES. Tap the invite link I am sending you to join the WhatsApp group.`);
  } else {
    H.join(g, u.id); // simulator: add them straight away
    await send(u, `🎉 Good news! *${g.name}* said YES. You are now in the group. Say hello to your new families!`);
  }
  await sayInGroup(g, `Thank you for voting. Everyone said yes, so a new family is joining. Please welcome ${u.answers.name}! 👋`);
};

// ---------- step 5b: group said no (or did not answer in 48 hours) ----------
exports.declined = async (u, g) => {
  u.bot.rejectedBy.push(g.id);
  u.bot.asked = null;
  await sayInGroup(g, `Thank you for voting. This request is now closed.`);
  await offer(u, `Sorry, *${g.name}* is not able to take a new family right now. This is not about you: groups sometimes have their own reasons. Let's find another one.`);
};

const groupName = id => H.db.groups.find(g => g.id === id)?.name || 'the group';

// ---------- demo data for the simulator ----------
// Starts from the normal Batu Pahat seed, then frees some families so the bot has someone to talk to:
//   Group 1 gets an open seat (Siti leaves), Lim's old pending request is cancelled.
//   Try: Lim (West side) -> sees Group 2 and Group 1. Siti -> sees Group 1. Noraini (Far north) -> no group fits.
exports.seedDemo = () => {
  H.seed();
  H.db.chats = [];
  const g1 = H.db.groups[0], g2 = H.db.groups[1];
  const siti = H.db.users.find(u => u.answers.name === 'Siti');
  const lim = H.db.users.find(u => u.answers.name === 'Lim');
  g1.members = g1.members.filter(x => x !== siti.id); g1.joined = g1.joined.filter(x => x !== siti.id); delete g1.invites[siti.id];
  siti.status = 'Available'; siti.groupId = null;
  H.db.polls = []; g2.hold = null; lim.status = 'Available'; lim.groupId = null;
  H.save();
};
