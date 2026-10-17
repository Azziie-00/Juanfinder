export type ReportStudent = { UserID: number; UserCode: string; Name: string; Course: string; IsLeader: boolean };
export type ReportGroup = { GroupID: number; GroupName: string; Course: string; MemberCount: number; Members: ReportStudent[] };
export type AdviserReport = { AdviserName: string; Summary: { Groups: number; StudentMembers: number; AvailableSlots: number; Capacity: number }; Groups: ReportGroup[] };
export type ReportKind = 'groups' | 'students';

export const matchesStudent = (student: ReportStudent, query: string) => {
  const term = query.trim().toLowerCase();
  return !term || student.Name.toLowerCase().includes(term) || student.UserCode.toLowerCase().includes(term);
};

export async function createAdviserExport(report: AdviserReport, kind: ReportKind, format: 'pdf' | 'xlsx', query: string, date = new Date()) {
  const title = kind === 'groups' ? 'Student Groups Summary' : 'Student Member List';
  const headers = kind === 'groups' ? ['Group Name', 'Course', 'Member Count'] : ['Student ID', 'Name', 'Course', 'Group'];
  const rows = kind === 'groups' ? report.Groups.map(g => [g.GroupName, g.Course, g.MemberCount])
    : report.Groups.flatMap(g => g.Members.filter(s => matchesStudent(s, query)).map(s => [s.UserCode, s.Name, s.Course, g.GroupName]));
  if (!rows.length) throw new Error('No matching records to export.');
  const metadata = [`Adviser: ${report.AdviserName}`, `Export date: ${date.toLocaleString('en-PH', { timeZone: 'Asia/Manila', dateStyle: 'medium', timeStyle: 'short' })} (Asia/Manila)`, `Search: ${query.trim() || 'All students'}`];
  if (format === 'xlsx') {
    const { default: ExcelJS } = await import('exceljs');
    const workbook = new ExcelJS.Workbook();
    workbook.creator = report.AdviserName; workbook.created = date;
    const sheet = workbook.addWorksheet(kind === 'groups' ? 'Groups' : 'Students');
    sheet.addRow([title]); metadata.forEach(line => sheet.addRow([line])); sheet.addRow([]);
    sheet.addRow(headers); rows.forEach(row => sheet.addRow(row));
    for (let row = 1; row <= 4; row++) { sheet.mergeCells(row, 1, row, headers.length); sheet.getRow(row).height = row === 1 ? 28 : 30; }
    sheet.getRow(1).font = { bold: true, size: 16, color: { argb: 'FF1A2A4A' } };
    sheet.getRow(6).eachCell(cell => { cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }; cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1A2A4A' } }; });
    sheet.columns.forEach((column, i) => { column.width = rows.reduce((width, row) => Math.min(55, Math.max(width, String(row[i]).length + 2)), 18); column.alignment = { vertical: 'top', wrapText: true }; });
    sheet.getRow(6).height = 26;
    rows.forEach((row, i) => { sheet.getRow(i + 7).height = Math.max(26, ...row.map((value, column) => Math.ceil(String(value).length / (sheet.getColumn(column + 1).width || 18)) * 16)); });
    sheet.views = [{ state: 'frozen', ySplit: 6 }];
    sheet.autoFilter = { from: { row: 6, column: 1 }, to: { row: rows.length + 6, column: headers.length } };
    sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
    const buffer = await workbook.xlsx.writeBuffer();
    return new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }
  const [{ jsPDF }, { autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setTextColor(26, 42, 74); doc.setFontSize(18); doc.text(title, 14, 18);
  doc.setFontSize(10);
  let tableY = 27;
  metadata.forEach(line => { const lines = doc.splitTextToSize(line, 265); doc.text(lines, 14, tableY); tableY += lines.length * 5 + 2; });
  autoTable(doc, { startY: tableY + 3, head: [headers], body: rows, margin: { top: 15, bottom: 18 }, styles: { fontSize: 10, cellPadding: 4, textColor: [26, 42, 74], overflow: 'linebreak' }, headStyles: { fillColor: [26, 42, 74], textColor: [255, 255, 255] }, alternateRowStyles: { fillColor: [239, 244, 250] }, rowPageBreak: 'avoid', didDrawPage: () => { doc.setFontSize(9); doc.text(`JuanFinder | Page ${doc.getNumberOfPages()}`, 14, doc.internal.pageSize.height - 8); } });
  return doc.output('blob');
}
