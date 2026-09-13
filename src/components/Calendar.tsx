import { useState } from 'react';

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const DAYS   = ['Su','Mo','Tu','We','Th','Fr','Sa'];

export default function Calendar() {
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
