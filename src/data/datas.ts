//Types
export interface GroupData {
  id: string;
  name: string;
  desc: string;
  specialty: string;
  slots?: number;
  members: number;
  maxMembers: number;
  course: string;
  status: string;
  availability: string;
  ownerId?: number;
  memberNames?: string[];
  _joined?: boolean;
  _memberNames?: string[];
  finalizedAt?: string | null;
}

export interface StudentData {
  id: string;
  name: string;
  specialty: string;
  group: string;
  availability: string;
  year: string;
  course: string;
  skills: string[];
  status: string;
  email: string;
  groupStatus?: string | null;
  groupLeader?: string;
}

export interface GroupMember {
  name: string;
  role: 'owner' | 'member';
}

export interface PendingRequest {
  id: string;
  name: string;
  course: string;
  userId?: number;
  expiresAt?: string;
}

export interface MyGroupData {
  id: string;
  name: string;
  desc: string;
  specialty: string;
  maxMembers: number;
  skills: string[];
  pending: PendingRequest[];
  members: GroupMember[];
  status?: string;
  finalizedAt?: string | null;
  ownerId?: number;
}

export interface UserCredential {
  id: string;
  password: string;
  name: string;
}

export interface AuthUser {
  name: string;
  id: string;
  role: 'student' | 'adviser' | 'admin' | 'superadmin';
  course?: string;
  sessionToken?: string;
  passwordChangeRequired?: boolean;
}

//Stats
export const STATS = { finder: 400, adviser: 10 };

//Adviser dashboard data
export const ADVISER_STATS = { advisee: 10, group: 18, studentList: 250 };

//Advisee groups (Advisee page)
export interface AdviseeGroup {
  id: string;
  groupName: string;
  title: string;
  members: string[];
  pending: boolean;
}

export const ADVISEE_GROUPS: AdviseeGroup[] = [
  { id:'ag1', groupName:'JUANFINDER GROUP', title:'JUAN: A web-based capstone project', members:['Cyrus','Adrian','Zuniega','Sale'], pending:true },
  { id:'ag2', groupName:'DEVELOPER GROUP',   title:'', members:['Prince Charles Bermudez','Albert Orbase','Chap','Lowkey Scheidue'], pending:true },
  { id:'ag3', groupName:'Capstone',  title:'', members:[], pending:false },
  { id:'ag4', groupName:'Albertos',  title:'', members:[], pending:false },
];

export interface AdviserAnnouncement { title: string; detail: string; }
export const ADVISER_ANNOUNCEMENT: AdviserAnnouncement = {
  title: 'Announcement',
  detail: 'No announcement posted yet. Tap the + button to share an update with your advisees.',
};

export interface NotificationItem {
  id: string;
  name: string;
  action: string;
  time: string;
  read: boolean;
}
export const NOTIFICATIONS: NotificationItem[] = [
  { id:'n1', name:'Ma. Franchesca Mangalindan', action:"Due soon: assignment 'Web Design Presentation'", time:'Mar 28, 7:54 am', read:false },
  { id:'n2', name:'Jerson Nolasco',              action:"Due soon: assignment '05 Laboratory Exercise'",  time:'Mar 28, 11:04 am', read:false },
  { id:'n3', name:'Ma. Franchesca Mangalindan', action:"Graded: assignment 'Website Design Activity'",   time:'Mar 26, 8:34 am', read:true },
  { id:'n4', name:'Ma. Franchesca Mangalindan', action:'You were awarded 100 points',                     time:'Mar 26, 8:00 am', read:true },
  { id:'n5', name:'Ma. Franchesca Mangalindan', action:"Graded: assignment '04 Laboratory Exercise'",     time:'Mar 25, 9:12 am', read:true },
];

export const ADVISER = { name: 'Orbase, Albert', announcement: 'No announcements yet.' };

//Student profile (Profile page)
export interface StudentProfile {
  studentId: string;
  course: string;
  yearLevel: string;
  birthdate: string;
  gender: string;
  socials: string;
  bio: string;
  skills: string[];
  lastLogin: string;
}

export const PROFILE: StudentProfile = {
  studentId: '2000667788',
  course: 'BSIT',
  yearLevel: '3Y2',
  birthdate: '08/10/2005',
  gender: 'Male',
  socials: 'https://www.facebook.com/JDCruz',
  bio: "Hi! I'm Juan Dela Cruz, a BSIT student who is passionate about software development and problem solving. I'm looking for a group to build amazing projects together.",
  skills: ['UI Designer', 'Database'],
  lastLogin: '3 days ago',
};

//Advisers (Adviser page)
export interface AdviserData {
  id: string;
  name: string;
  slots: number | null;
  maxSlots: number;
  bio: string;
  gender?: string;
  requirements: string[];
}

export const ADVISERS: AdviserData[] = [
  { id:'adv1', name:'Joselito G. Oyao',
    bio:'Full-Stack instructor specializing in AI-driven capstone projects. Available for consultation and thesis guidance for BSIT/BSCS students.',
    slots:null, maxSlots:10,
    requirements:['Monday - Thursday: 1pm-4pm', 'A4 Paper', 'Attendance Form(?)', 'Message before consult'] },
  { id:'adv2', name:'Dexter B. Oseña',
    bio:'Focuses on data science and machine learning capstone projects. Prefers groups with a clear problem statement before the first meeting.',
    slots:null, maxSlots:10,
    requirements:['Tuesday - Friday: 9am-12nn', 'Project proposal draft', 'Recommendation letter'] },
  { id:'adv3', name:'Prince Aron E. Chavez',
    bio:'Specializes in mobile and IoT capstone projects. Requires groups to have at least two members before applying.',
    slots:null, maxSlots:10,
    requirements:['Wednesday - Saturday: 1pm-5pm', 'Finalized project title', 'Group of at least 2 members'] },
  { id:'adv4', name:'Leny Z. Laya',
    bio:'Guides groups on web development and project management capstones. Open consultation hours are posted weekly.',
    slots:null, maxSlots:10,
    requirements:['Monday - Wednesday: 10am-1pm', 'Endorsement form', 'Capstone proposal draft'] },
  { id:'adv5', name:'Albert C. Orbase',
    bio:'Open to AI and Full-Stack capstone projects. Enjoys working with groups that already have a system architecture outline ready.',
    slots:null, maxSlots:10,
    requirements:['Thursday - Friday: 2pm-5pm', 'System architecture outline', 'Project proposal draft'] },
  { id:'adv6', name:'Maricel D. Fernandez',
    bio:'Advises on UI/UX and product design capstone projects. Requires a wireframe or prototype before the first consultation.',
    slots:null, maxSlots:10,
    requirements:['Monday - Friday: 3pm-5pm', 'Wireframe or prototype', 'Confirmed project specialty'] },
];

//Seed Groups (Dashboard)
export const SEED_GROUPS: GroupData[] = [
  { id:'g4', name:'LearnBot: Adaptive Tutoring', desc:'Personalized AI tutoring platform that adapts to K-12 learners through real-time performance analysis.', slots:2, specialty:'EdTech / AI', members:2, maxMembers:4, course:'BSIT', status:'Open', availability:'-2/4' },
  { id:'g3', name:'Energy Saving Pro', desc:'Smart energy consumption monitoring and automation system for buildings using IoT sensors.', slots:2, specialty:'IoT / Embedded Systems', members:2, maxMembers:4, course:'BSIT', status:'Open', availability:'-2/4' },
  { id:'g2', name:'AirCast: AI-Based Tool', desc:'Real-time air quality monitoring and forecasting tool using ML models trained on environmental sensor data.', slots:3, specialty:'AI / Data Science', members:1, maxMembers:4, course:'BSCS', status:'Open', availability:'-3/4' },
  { id:'g1', name:'EcoSort: Smart Waste Classification', desc:'AI-powered waste sorting system using computer vision to classify recyclables, organics, and residuals.', slots:2, specialty:'AI / Computer Vision', members:2, maxMembers:4, course:'BSIT', status:'Open', availability:'-2/4' },
];

//Finder Students
export const STUDENTS: StudentData[] = [
  { id:'s1',  name:'Juan B. ASD',       specialty:'Document / UI Design', group:'Energy Saving Pro',   availability:'-2/4', year:'3rd Year', course:'BSIT', skills:['UI/UX','Figma','Documentation'],       status:'Has a group',       email:'juan.asd@sti.edu.ph' },
  { id:'s2',  name:'Suka B. Blyat',     specialty:'Front-End',            group:'Capstone Management', availability:'-1/4', year:'3rd Year', course:'BSCS', skills:['React','HTML','CSS'],                   status:'Has a group',       email:'suka.blyat@sti.edu.ph' },
  { id:'s3',  name:'Rush V. Suika',     specialty:'Back-End',             group:'--',                  availability:'--',   year:'4th Year', course:'BSIT', skills:['Node.js','Express','MongoDB'],           status:'Looking for group', email:'rush.suika@sti.edu.ph' },
  { id:'s4',  name:'Dess A. Canu',      specialty:'Database',             group:'--',                  availability:'--',   year:'3rd Year', course:'BSCS', skills:['MySQL','PostgreSQL','Firebase'],         status:'Looking for group', email:'dess.canu@sti.edu.ph' },
  { id:'s5',  name:'King Lebron',       specialty:'Document',             group:'Energy Saving Pro',   availability:'-2/4', year:'4th Year', course:'BSIT', skills:['Technical Writing','MS Office','LaTeX'], status:'Has a group',       email:'king.lebron@sti.edu.ph' },
  { id:'s6',  name:"Jack Ok'len",       specialty:'Developer',            group:'Cappebbles',          availability:'-3/4', year:'3rd Year', course:'BSCS', skills:['Python','Java','C++'],                  status:'Has a group',       email:'jack.oklen@sti.edu.ph' },
  { id:'s7',  name:'Chap E. Enrique',   specialty:'Back-End',             group:'Cappebbles',          availability:'-3/4', year:'4th Year', course:'BSIT', skills:['PHP','Laravel','MySQL'],                status:'Has a group',       email:'chap.enrique@sti.edu.ph' },
  { id:'s8',  name:'Jerome J. Jamal',   specialty:'UI Design',            group:'--',                  availability:'--',   year:'3rd Year', course:'BSCS', skills:['Figma','Adobe XD','Prototyping'],       status:'Looking for group', email:'jerome.jamal@sti.edu.ph' },
  { id:'s9',  name:'Maria Santos',      specialty:'Machine Learning',     group:'--',                  availability:'--',   year:'3rd Year', course:'BSIT', skills:['Python','TensorFlow','Data Science'],   status:'Looking for group', email:'maria.santos@sti.edu.ph' },
  { id:'s10', name:'Carlo Reyes',       specialty:'Front-End',            group:'--',                  availability:'--',   year:'3rd Year', course:'BSCS', skills:['Vue.js','Tailwind','TypeScript'],       status:'Looking for group', email:'carlo.reyes@sti.edu.ph' },
  { id:'s11', name:'Angela Cruz',       specialty:'Data Science',         group:'AirCast Team',        availability:'-2/4', year:'4th Year', course:'BSIT', skills:['Python','Pandas','SQL'],                status:'Has a group',       email:'angela.cruz@sti.edu.ph' },
  { id:'s12', name:'Luis Mendoza',      specialty:'IoT / Hardware',       group:'--',                  availability:'--',   year:'3rd Year', course:'BSCS', skills:['Arduino','C++','Raspberry Pi'],         status:'Looking for group', email:'luis.mendoza@sti.edu.ph' },
];

//Finder Groups
export const GROUPS: GroupData[] = [
  { id:'g1',  name:'Energy Saving Pro',    members:2, maxMembers:4, course:'BSIT', specialty:'IoT / Embedded Systems',  desc:'Smart energy consumption monitoring and automation system.',  status:'Open', availability:'-2/4' },
  { id:'g2',  name:'Capstone Management',  members:3, maxMembers:4, course:'BSCS', specialty:'Web / Project Management', desc:'Integrated platform for managing capstone projects.',         status:'Open', availability:'-1/4' },
  { id:'g3',  name:'Cappebbles',           members:1, maxMembers:4, course:'BSIT', specialty:'Mobile / Back-End',        desc:'Cross-platform mobile app for student resource sharing.',    status:'Open', availability:'-3/4' },
  { id:'g4',  name:'AirCast Team',         members:2, maxMembers:4, course:'BSCS', specialty:'AI / Data Science',        desc:'Real-time air quality monitoring and ML-based forecasting.', status:'Open', availability:'-2/4' },
  { id:'g5',  name:'EcoSort Team',         members:3, maxMembers:4, course:'BSIT', specialty:'AI / Computer Vision',     desc:'AI-powered waste classification using computer vision.',      status:'Open', availability:'-1/4' },
  { id:'g6',  name:'MediTrack',            members:4, maxMembers:4, course:'BSCS', specialty:'Health Tech',              desc:'Wearable-integrated patient health monitoring system.',       status:'Full', availability:'Full' },
  { id:'g7',  name:'LearnBot',             members:2, maxMembers:4, course:'BSIT', specialty:'EdTech / AI',              desc:'Adaptive AI tutoring platform for K-12 learners.',           status:'Open', availability:'-2/4' },
  { id:'g8',  name:'SafeRoute',            members:1, maxMembers:4, course:'BSCS', specialty:'GIS / Disaster Tech',      desc:'Real-time disaster evacuation route optimizer.',             status:'Open', availability:'-3/4' },
  { id:'g9',  name:'CropSense',            members:4, maxMembers:4, course:'BSIT', specialty:'IoT / Agriculture',        desc:'IoT-based smart crop monitoring and irrigation controller.',  status:'Full', availability:'Full' },
  { id:'g10', name:'ByteShield',           members:2, maxMembers:4, course:'BSCS', specialty:'Cybersecurity',            desc:'Network intrusion detection system using ML models.',         status:'Open', availability:'-2/4' },
];

//Auth Credentials
export const VALID_USERS: Record<string, UserCredential[]> = {
  student: [
    { id:'2023-00001',       password:'juan123',    name:'Juan Dela Cruz' },
    { id:'juan@sti.edu.ph',  password:'juan123',    name:'Juan Dela Cruz' },
  ],
  adviser: [
    { id:'orbase',           password:'adviser123', name:'Albert Orbase' },
    { id:'orbase@sti.edu.ph',password:'adviser123', name:'Albert Orbase' },
  ],
  admin: [
    { id:'admin',            password:'admin123',   name:'System Admin'  },
  ],
};

//AI Config
export const AI_CONFIG = {
  model: 'claude-sonnet-4-6',
  maxTokens: 1000,
  systemPrompt: `You are JUAN-AI, an AI assistant embedded in JuanFinder — an STI Philippines platform where students find and join capstone research groups. Help students with group creation, joining, and research title recommendations. Be warm, concise (under 80 words), and specific.`,
  groupRecommendationPrompt: `You are a capstone group recommendation engine for JuanFinder, an STI Philippines platform. Return ONLY a valid JSON array of exactly 4 objects. Each has: "name" (string), "desc" (string, max 18 words), "slots" (number 1-4). No markdown, just raw JSON array.`,
  titlePromptTemplate: `You are a capstone research title recommender for STI Philippines students. The student just joined "{groupName}". Generate exactly 3 capstone title suggestions. Return ONLY a valid JSON array of 3 strings. No markdown.`,
};

//Helpers
const NAME_POOL = [
  'Dela Cruz, Juan','Santos, Maria','Reyes, Carlo','Mendoza, Luis',
  'Cruz, Angela','Villanueva, Ramon','Aquino, Gina','Dela Torre, Mark',
  'Lim, Patricia','Balingasa, Adrian','Zuniega, Paul','Garcia, Jose',
];

export function getMemberNames(group: GroupData): string[] {
  const count = group.members || 1;
  const seed  = group.id ? group.id.charCodeAt(group.id.length - 1) % NAME_POOL.length : 0;
  const names: string[] = [];
  let idx = seed;
  while (names.length < count) {
    names.push(NAME_POOL[idx % NAME_POOL.length]);
    idx++;
  }
  return names;
}

export function getInitials(name: string): string {
  return (name || 'JD').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
}