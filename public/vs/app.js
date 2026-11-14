import debates from './debates.json';

let data = debates;
let currentPairing = null;
let currentTopic = null;

function init() {
  renderPairingTabs();
  selectPairing(data.pairings[0].id);
}

function renderPairingTabs() {
  const container = document.getElementById('pairing-tabs');
  container.innerHTML = '';

  for (const pairing of data.pairings) {
    const [a, b] = pairing.speakers;
    const nameA = data.speakers[a] || a;
    const nameB = data.speakers[b] || b;
    const label = `${nameA} vs. ${nameB}`;

    const btn = document.createElement('button');
    btn.textContent = label;
    btn.dataset.pairingId = pairing.id;
    btn.className = 'pairing-tab';
    btn.addEventListener('click', () => selectPairing(pairing.id));
    container.appendChild(btn);
  }
}

function selectPairing(pairingId) {
  currentPairing = data.pairings.find(p => p.id === pairingId);
  if (!currentPairing) return;

  // Update pairing tab styles
  document.querySelectorAll('#pairing-tabs button').forEach(btn => {
    if (btn.dataset.pairingId === pairingId) {
      btn.className = 'pairing-tab is-active';
    } else {
      btn.className = 'pairing-tab';
    }
  });

  renderTopicTabs();
  selectTopic(currentPairing.topics[0].name);
}

function renderTopicTabs() {
  const container = document.getElementById('topic-tabs');
  container.innerHTML = '';

  for (const topic of currentPairing.topics) {
    const btn = document.createElement('button');
    btn.textContent = topic.name;
    btn.dataset.topic = topic.name;
    btn.className = 'topic-tab';
    btn.addEventListener('click', () => selectTopic(topic.name));
    container.appendChild(btn);
  }
}

function selectTopic(topicName) {
  currentTopic = currentPairing.topics.find(t => t.name === topicName);
  if (!currentTopic) return;

  // Update topic tab styles
  document.querySelectorAll('#topic-tabs button').forEach(btn => {
    if (btn.dataset.topic === topicName) {
      btn.className = 'topic-tab is-active';
    } else {
      btn.className = 'topic-tab';
    }
  });

  renderDebate();
}

function renderDebate() {
  const [speakerA, speakerB] = currentPairing.speakers;
  const nameA = data.speakers[speakerA] || speakerA;
  const nameB = data.speakers[speakerB] || speakerB;

  const quotesA = currentTopic.quotes.filter(q => q.speaker === speakerA);
  const quotesB = currentTopic.quotes.filter(q => q.speaker === speakerB);

  document.getElementById('speaker-a').innerHTML = renderSpeakerColumn(nameA, quotesA);
  document.getElementById('speaker-b').innerHTML = renderSpeakerColumn(nameB, quotesB);

  // Corpus links
  document.getElementById('corpus-link-a').innerHTML =
    `<a href="/corpus/?speaker=${speakerA}" class="text-link">${nameA}</a>`;
  document.getElementById('corpus-link-b').innerHTML =
    `<a href="/corpus/?speaker=${speakerB}" class="text-link">${nameB}</a>`;
}

function renderSpeakerColumn(name, quotes) {
  let html = `<h2 class="speaker-name">${name}</h2>`;

  for (const quote of quotes) {
    const dateStr = quote.date ? `<span class="quote-date">${quote.date}</span>` : '';
    html += `
      <blockquote class="quote">
        <p class="quote-text">${escapeHtml(quote.text)}</p>
        <cite class="quote-cite">${escapeHtml(quote.source)}${dateStr}</cite>
      </blockquote>
    `;
  }

  return html;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

init();
