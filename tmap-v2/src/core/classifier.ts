// Task Classifier — maps user input to one or more of the 16 Coagentix AI categories.
// Multiple categories may be assigned simultaneously for multi-step projects.

import type { TaskCategory } from '../types.js';

interface CategoryRule {
  category: TaskCategory;
  patterns: RegExp[];
  weight: number;
}

const RULES: CategoryRule[] = [
  {
    category: 'image_generation',
    weight: 10,
    patterns: [
      /\bgenerate\b.{0,30}\bimage\b/i, /\bcreate\b.{0,30}\bimage\b/i,
      /\bdraw\b/i, /\billustrat/i, /\bartwork\b/i, /\bpaint(ing)?\b/i,
      /\bphoto(graph)?\b.{0,20}\bcreate\b/i, /\bai.{0,10}(image|art|picture)/i,
      /สร้างรูป/i, /วาดรูป/i, /ภาพ.{0,10}สร้าง/i,
    ],
  },
  {
    category: 'image_editing',
    weight: 10,
    patterns: [
      /\bedit\b.{0,30}\bimage\b/i, /\bremove\b.{0,30}(background|object)/i,
      /\bupscale\b/i, /\binpaint/i, /\boutpaint/i, /\bstyle transfer/i,
      /\benhance\b.{0,20}\bphoto\b/i, /\bretouche?/i, /\bcrop\b.{0,20}image/i,
      /แก้ไขรูป/i, /ตัดพื้นหลัง/i,
    ],
  },
  {
    category: 'coding',
    weight: 8,
    patterns: [
      /\bcode\b/i, /\bcoding\b/i, /\bprogram(ming)?\b/i, /\bdebug\b/i,
      /\bfunction\b/i, /\bclass\b/i, /\bapi\b/i, /\bscript\b/i,
      /\brepository\b/i, /\bcommit\b/i, /\breact\b/i, /\bnext\.?js\b/i,
      /\bnode\.?js\b/i, /\bpython\b/i, /\btypescript\b/i, /\bjavascript\b/i,
      /\bdocker\b/i, /\bdeploy\b/i, /\barchitecture\b/i,
      /เขียนโค้ด/i, /โปรแกรม/i, /ดีบัก/i, /แก้บั๊ก/i,
    ],
  },
  {
    category: 'ui_design',
    weight: 9,
    patterns: [
      /\bui\b/i, /\buser interface\b/i, /\bdesign\b.{0,20}\b(page|screen|layout|component)\b/i,
      /\bwireframe\b/i, /\bmockup\b/i, /\bprototype\b/i, /\bfigma\b/i,
      /\bbutton\b.{0,20}design/i, /\bcolor\b.{0,20}(scheme|palette)/i,
      /ออกแบบ.{0,20}หน้าจอ/i, /ออกแบบ.{0,20}UI/i,
    ],
  },
  {
    category: 'ux_design',
    weight: 9,
    patterns: [
      /\bux\b/i, /\buser experience\b/i, /\buser flow\b/i, /\buser journey\b/i,
      /\busability\b/i, /\baccessibility\b/i, /\binteraction design\b/i,
      /\bpersona\b/i, /\bempathy map\b/i,
      /ประสบการณ์ผู้ใช้/i, /การออกแบบ UX/i,
    ],
  },
  {
    category: 'product_design',
    weight: 7,
    patterns: [
      /\bproduct design\b/i, /\bproduct strategy\b/i, /\bfeature\b.{0,20}(design|plan)/i,
      /\bprd\b/i, /\bproduct requirements?\b/i, /\broadmap\b/i, /\bpivot\b/i,
      /ออกแบบผลิตภัณฑ์/i, /กลยุทธ์ผลิตภัณฑ์/i,
    ],
  },
  {
    category: 'research',
    weight: 6,
    patterns: [
      /\bresearch\b/i, /\bsummarize\b/i, /\bsummary\b/i, /\bexplain\b/i,
      /\bwhat is\b/i, /\bhow does\b/i, /\bwhy does\b/i, /\bcompare\b/i,
      /\banalyze\b/i, /\bfind information\b/i, /\blook up\b/i,
      /วิจัย/i, /ค้นหาข้อมูล/i, /อธิบาย/i, /สรุป/i,
    ],
  },
  {
    category: 'writing',
    weight: 6,
    patterns: [
      /\bwrite\b.{0,20}\b(blog|article|post|essay|report|email|letter|story|content)\b/i,
      /\bdocument(ation)?\b/i, /\bcopywriting\b/i, /\bproofreading?\b/i,
      /\bdraft\b/i, /\bparaphrase\b/i, /\brewrite\b/i,
      /เขียน.{0,20}(บทความ|รายงาน|อีเมล|จดหมาย|เนื้อหา)/i,
    ],
  },
  {
    category: 'mathematics',
    weight: 9,
    patterns: [
      /\bcalculate\b/i, /\bsolve\b.{0,20}\b(equation|math|problem)\b/i,
      /\bintegral\b/i, /\bderivative\b/i, /\bmatrix\b/i, /\bstatistic\b/i,
      /\balgebra\b/i, /\bcalculus\b/i, /\bgeometry\b/i, /\bprobability\b/i,
      /\bprove\b.{0,20}\btheorem\b/i, /\d+\s*[+\-*/^]\s*\d+/,
      /คำนวณ/i, /สมการ/i, /คณิตศาสตร์/i,
    ],
  },
  {
    category: 'science',
    weight: 6,
    patterns: [
      /\bphysics\b/i, /\bchemistry\b/i, /\bbiology\b/i, /\bastronomy\b/i,
      /\bquantum\b/i, /\bmolecule\b/i, /\batom\b/i, /\bgenetics\b/i,
      /\bevolution\b/i, /\bscientific\b/i, /\bexperiment\b/i,
      /ฟิสิกส์/i, /เคมี/i, /ชีววิทยา/i, /วิทยาศาสตร์/i,
    ],
  },
  {
    category: 'data_analysis',
    weight: 8,
    patterns: [
      /\bdata analysis\b/i, /\banalyze data\b/i, /\bcsv\b/i, /\bspreadsheet\b/i,
      /\bchart\b/i, /\bgraph\b/i, /\bvisualization\b/i, /\bdataset\b/i,
      /\bml\b.{0,10}\bmodel\b/i, /\bmachine learning\b/i, /\bai model\b/i,
      /วิเคราะห์ข้อมูล/i, /แผนภูมิ/i, /กราฟ/i,
    ],
  },
  {
    category: 'education',
    weight: 5,
    patterns: [
      /\bteach\b/i, /\btutor\b/i, /\blearn\b/i, /\blesson\b/i, /\bcourse\b/i,
      /\bquiz\b/i, /\bexercise\b/i, /\bhomework\b/i, /\bstudy\b/i,
      /สอน/i, /เรียน/i, /การศึกษา/i, /แบบทดสอบ/i,
    ],
  },
  {
    category: 'business',
    weight: 6,
    patterns: [
      /\bbusiness plan\b/i, /\bmarketing\b/i, /\bstrategy\b/i, /\bfinancial\b/i,
      /\brevenue\b/i, /\bstartup\b/i, /\bpitch deck\b/i, /\bswot\b/i,
      /\bkpi\b/i, /\binvestor\b/i, /\bsales\b/i,
      /แผนธุรกิจ/i, /การตลาด/i, /กลยุทธ์ธุรกิจ/i,
    ],
  },
  {
    category: 'translation',
    weight: 9,
    patterns: [
      /\btranslate\b/i, /\btranslation\b/i, /\blocalize\b/i, /\blocalization\b/i,
      /\bfrom (english|thai|japanese|chinese|french|spanish|german)\b/i,
      /\bto (english|thai|japanese|chinese|french|spanish|german)\b/i,
      /แปล(ภาษา)?/i, /ภาษาไทย.{0,20}ภาษาอังกฤษ/i,
    ],
  },
  {
    category: 'video',
    weight: 9,
    patterns: [
      /\bvideo\b.{0,20}(script|edit|create|generate|produce)/i,
      /\bscreenplay\b/i, /\bstoryboard\b/i, /\byoutube\b/i, /\btiktok\b/i,
      /\bvlog\b/i, /\bshort film\b/i,
      /วิดีโอ/i, /สคริปต์วิดีโอ/i,
    ],
  },
  {
    category: 'audio',
    weight: 9,
    patterns: [
      /\baudio\b/i, /\bpodcast\b/i, /\bsong\b/i, /\blyric\b/i,
      /\bmusic\b/i, /\bsound effect\b/i, /\bvoiceover\b/i, /\bnarration\b/i,
      /เพลง/i, /เนื้อเพลง/i, /พอดแคสต์/i,
    ],
  },
];

export interface ClassificationResult {
  categories: TaskCategory[];
  primary: TaskCategory;
  scores: Partial<Record<TaskCategory, number>>;
  isMultiStep: boolean;
}

export function classifyTask(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  const scores: Partial<Record<TaskCategory, number>> = {};

  for (const rule of RULES) {
    const matchCount = rule.patterns.filter((p) => p.test(lower)).length;
    if (matchCount > 0) {
      scores[rule.category] = matchCount * rule.weight;
    }
  }

  const sorted = (Object.entries(scores) as [TaskCategory, number][])
    .sort((a, b) => b[1] - a[1]);

  const categories = sorted.map(([cat]) => cat);
  const primary: TaskCategory = categories[0] ?? 'research';
  const isMultiStep = categories.length >= 3 || text.split(/[.!?]/).length >= 4;

  if (isMultiStep && !categories.includes('multi_step')) {
    categories.push('multi_step');
  }

  return { categories, primary, scores, isMultiStep };
}

export function categoryLabel(cat: TaskCategory): string {
  const labels: Record<TaskCategory, string> = {
    coding: 'Coding',
    image_generation: 'Image Generation',
    image_editing: 'Image Editing',
    research: 'Research',
    writing: 'Writing',
    mathematics: 'Mathematics',
    science: 'Science',
    data_analysis: 'Data Analysis',
    education: 'Education',
    business: 'Business',
    translation: 'Translation',
    ui_design: 'UI Design',
    ux_design: 'UX Design',
    product_design: 'Product Design',
    video: 'Video',
    audio: 'Audio',
    multi_step: 'Multi-Step Project',
  };
  return labels[cat] ?? cat;
}
