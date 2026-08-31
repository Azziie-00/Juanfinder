import { useState, useEffect, useRef } from 'react';
import { Row, Col, InputGroup, Form, Spinner } from 'react-bootstrap';
import Layout from '../components/Layout';
import { useAuth } from '../context/useAuth';
import { STATS, ADVISER, SEED_GROUPS, AI_CONFIG } from '../data/datas';
import type { GroupData } from '../data/datas';
import '../styles/dashboard.css';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

interface ChatMessage { role: 'ai' | 'user'; text: string; }
interface AIMessage   { role: 'user' | 'assistant'; content: string; }

/* Ai Chat*/
async function callAI(systemPrompt: string, messages: AIMessage[]): Promise<string> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AI_CONFIG.model, max_tokens: AI_CONFIG.maxTokens, system: systemPrompt, messages }),
  });
  const data = await res.json();
  return (data.content as Array<{ text?: string }> || []).map(i => i.text || '').join('');
}

function Calendar() {
  const now = new Date();
  const [yr, setYr] = useState(now.getFullYear());
  const [mo, setMo] = useState(now.getMonth());
  const first = new Date(yr, mo, 1).getDay();
  const total = new Date(yr, mo + 1, 0).getDate();
  const prev  = () => { if (mo===0){setMo(11);setYr(y=>y-1);}else setMo(m=>m-1); };
  const next  = () => { if (mo===11){setMo(0);setYr(y=>y+1);}else setMo(m=>m+1); };
  return (
    <div className="calendar-card h-100">
      <div className="cal-header">
        <button className="cal-nav" onClick={prev}><i className="ti ti-chevron-left"></i></button>
        <div className="cal-title">Calendar</div>
        <button className="cal-nav" onClick={next}><i className="ti ti-chevron-right"></i></button>
      </div>
      <div className="cal-scroll">
        <div className="cal-month-label">{MONTHS[mo]} {yr}</div>
        <div className="cal-grid">
          {DAYS.map(d => <div key={d} className="cal-head">{d}</div>)}
          {Array(first).fill(null).map((_, i) => <div key={`b${i}`} className="cal-day empty"></div>)}
          {Array.from({ length: total }, (_, i) => i + 1).map(d => {
            const sun   = (first + d - 1) % 7 === 0;
            const today = d===now.getDate() && mo===now.getMonth() && yr===now.getFullYear();
            return <div key={d} className={`cal-day${sun?' sun':''}${today?' today':''}`}>{d}</div>;
          })}
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  const firstName = (user?.name || 'Student').trim().split(' ')[0];
  const [groups, setGroups]           = useState<GroupData[]>(SEED_GROUPS.map(g => ({ ...g })));
  const [joined, setJoined]           = useState<string | null>(null);
  const [chatHistory, setChatHistory] = useState<AIMessage[]>([]);
  const [messages, setMessages]       = useState<ChatMessage[]>([{ role:'ai', text:`Hi ${firstName}! I'm JUAN-AI. Tap any group to join and I'll recommend research titles for you!` }]);
  const [inputVal, setInputVal]       = useState('');
  const [aiLoading, setAiLoading]     = useState(false);
  const [titles, setTitles]           = useState<string[]>([]);
  const [titlesGroup, setTitlesGroup] = useState('');
  const chatRef = useRef<HTMLDivElement>(null);

  useEffect(() => { chatRef.current?.scrollTo(0, chatRef.current.scrollHeight); }, [messages]);

  const addBubble = (text: string, role: 'ai' | 'user') =>
    setMessages(m => [...m, { role, text }]);

  const sendMsg = async (text: string) => {
    if (!text.trim() || aiLoading) return;
    setInputVal('');
    addBubble(text, 'user');
    setAiLoading(true);
    const newHist: AIMessage[] = [...chatHistory, { role:'user', content:text }];
    try {
      const reply = await callAI(AI_CONFIG.systemPrompt, newHist);
      setChatHistory([...newHist, { role:'assistant', content:reply }]);
      addBubble(reply, 'ai');
    } catch { addBubble('Connection issue. Try again.', 'ai'); }
    setAiLoading(false);
  };

  const fetchTitles = async (groupName: string) => {
    setTitles([]); setTitlesGroup(groupName);
    try {
      const prompt = AI_CONFIG.titlePromptTemplate.replace('{groupName}', groupName);
      const raw    = await callAI(prompt, [{ role:'user', content:'Give 3 titles.' }]);
      setTitles(JSON.parse(raw.replace(/```json|```/g, '').trim()) as string[]);
    } catch { setTitles(['Could not load titles. Try again.']); }
  };

  const joinGroup = async (group: GroupData) => {
    setJoined(group.name);
    setGroups(gs => gs.map(g => g.id===group.id ? { ...g, slots: Math.max(0, (g.slots ?? 0) - 1) } : g));
    addBubble(`I joined "${group.name}"`, 'user');
    setAiLoading(true);
    const newHist: AIMessage[] = [...chatHistory, { role:'user', content:`Student joined "${group.name}". Welcome them warmly in under 50 words.` }];
    try {
      const reply = await callAI(AI_CONFIG.systemPrompt, newHist);
      setChatHistory([...newHist, { role:'assistant', content:reply }]);
      addBubble(reply, 'ai');
    } catch { addBubble('Welcome to the group!', 'ai'); }
    setAiLoading(false);
    await fetchTitles(group.name);
  };

  return (
    <Layout>
      <div className="dashboard-content">
        <Row className="g-3" style={{ flexShrink:0 }}>
          <Col xs={6} md={4}>
            <div className="stat-card h-100">
              <div className="stat-label"><i className="ti ti-users"></i> Finder</div>
              <div className="stat-num">{STATS.finder}</div>
            </div>
          </Col>
          <Col xs={6} md={4}>
            <div className="stat-card h-100">
              <div className="stat-label"><i className="ti ti-settings"></i> Adviser</div>
              <div className="stat-num">{STATS.adviser}</div>
            </div>
          </Col>
          <Col xs={12} md={4}><Calendar /></Col>
        </Row>

        <Row className="g-3 mt-0" style={{ flex:1, minHeight:0 }}>
          <Col xs={12} lg={8} className="d-flex flex-column gap-3">
            <div className="announce-card">
              <div className="announce-head">
                <div className="adviser-avatar"><i className="ti ti-user"></i></div>
                <div className="announce-label">Adviser | {ADVISER.name}</div>
              </div>
              <div className="announce-body"><div className="announce-msg">{ADVISER.announcement}</div></div>
            </div>
            <div className="groups-card flex-grow-1">
              <div className="groups-title">Recommended groups <span className="ai-badge">AI-powered</span></div>
              <div className="groups-scroll">
                {groups.map(g => (
                  <div key={g.id} className={`group-card${joined===g.name?' active':''}`} onClick={() => joinGroup(g)}>
                    <div className="group-card-name">{g.name}</div>
                    <div className="group-card-desc">{g.desc}</div>
                    <div className="group-card-footer">
                      <span className={`group-card-slots${(g.slots??0)===0?' full':''}`}>
                        {(g.slots??0)>0 ? `${g.slots} slot${g.slots!==1?'s':''} open` : 'Full'}
                      </span>
                      <button className="group-card-join" onClick={e => { e.stopPropagation(); joinGroup(g); }}>Join →</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </Col>

          <Col xs={12} lg={4}>
            <div className="ai-panel h-100" style={{ minHeight:380 }}>
              <div className="ai-panel-title">JUAN-AI Assistant</div>
              <div className="ai-recs">
                <div className="ai-recs-label">Group recommendations</div>
                {groups.map(g => (
                  <div key={g.id} className="ai-rec-item" onClick={() => joinGroup(g)} style={joined===g.name?{borderLeft:'3px solid #f59e0b'}:{}}>
                    <div className="ai-rec-item-top"><span>{g.name}</span><span className="slots">{g.slots} open</span></div>
                    <div className="ai-rec-item-desc">{g.desc}</div>
                  </div>
                ))}
              </div>
              {titlesGroup && (
                <div className="title-rec-section">
                  <div className="title-rec-header">
                    <span className="ai-recs-label">Title recommendation</span>
                    <span className="title-rec-group">{titlesGroup}</span>
                  </div>
                  <div className="title-list">
                    {titles.length===0
                      ? <div className="title-loading"><span className="typing-dot"></span><span className="typing-dot"></span><span className="typing-dot"></span>&nbsp;Generating…</div>
                      : titles.map((t,i) => (
                        <div key={i} className="title-item" onClick={() => sendMsg(`Tell me more about: "${t}"`)}>
                          <i className="ti ti-file-text"></i><span>{t}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>
              )}
              <div className="ai-chat" ref={chatRef}>
                {messages.map((m,i) => <div key={i} className={`bubble ${m.role}`}>{m.text}</div>)}
                {aiLoading && <div className="bubble ai"><span className="typing-dot"></span><span className="typing-dot"></span><span className="typing-dot"></span></div>}
              </div>
              <div className="ai-input-area">
                <InputGroup>
                  <Form.Control className="ai-input" placeholder="Ask about groups or titles…" value={inputVal} onChange={e => setInputVal(e.target.value)} onKeyDown={e => e.key==='Enter' && sendMsg(inputVal)} disabled={aiLoading} />
                  <button className="ai-send" onClick={() => sendMsg(inputVal)} disabled={aiLoading}>
                    {aiLoading ? <Spinner size="sm" /> : <i className="ti ti-send"></i>}
                  </button>
                </InputGroup>
              </div>
            </div>
          </Col>
        </Row>
      </div>
    </Layout>
  );
}