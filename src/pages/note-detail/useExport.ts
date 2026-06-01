import { useState } from 'react';
import html2pdf from 'html2pdf.js';
import { exportNotebook } from '@/services/api';

interface Session {
  id?: string;
  title: string;
  duration?: string;
}

interface Notebook {
  id?: string;
  title: string;
}

export function useExport(session: Session | undefined, notebook: Notebook | undefined) {
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [isExportingPDF, setIsExportingPDF] = useState(false);
  const [isExportingPackage, setIsExportingPackage] = useState(false);

  const exportMarkdown = (transcriptText: string, notes: Array<{ type: string; content: string }>) => {
    if (!session || !notebook) return;
    let md = `# ${session.title}\n\n> 所属科目：${notebook.title}\n`;
    if (session.duration) md += `> 课程时长：${session.duration}\n`;
    md += `> 导出时间：${new Date().toLocaleString('zh-CN')}\n\n`;
    md += `## 语音转文字\n\n${transcriptText.trim()}\n\n---\n\n`;
    if (notes.some(n => n.content.trim())) {
      md += `## 随堂笔记\n\n`;
      notes.filter(n => n.content.trim()).forEach((note, idx) => md += `### 笔记 ${idx + 1}\n\n${note.content}\n\n`);
    }
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${session.title}.md`; a.click();
    URL.revokeObjectURL(a.href);
    setShowExportMenu(false);
  };

  const exportPDF = async (transcriptText: string, notes: Array<{ type: string; content: string }>) => {
    if (!session || !notebook) return;
    setIsExportingPDF(true);
    try {
      const notesHtml = notes.filter(n => n.content.trim()).map((n, i) =>
        `<div style="margin-bottom:12px"><h4 style="color:#475569;margin:0 0 4px">笔记 ${i + 1}</h4><div>${n.content}</div></div>`
      ).join('');

      const container = document.createElement('div');
      container.style.position = 'absolute';
      container.style.left = '-9999px';
      container.style.width = '210mm';
      container.style.padding = '15mm';
      container.style.fontFamily = '"Microsoft YaHei","PingFang SC",sans-serif';
      container.style.fontSize = '13px';
      container.style.color = '#334155';
      container.style.lineHeight = '1.7';
      container.innerHTML = `
        <h1 style="font-size:22px;margin-bottom:6px;color:#1e293b">${session.title}</h1>
        <p style="color:#94a3b8;margin:0 0 16px;font-size:12px">
          ${notebook.title} &nbsp;|&nbsp; 时长 ${session.duration || '-'} &nbsp;|&nbsp; ${new Date().toLocaleString('zh-CN')}
        </p>
        <h2 style="font-size:16px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:20px 0 12px;color:#1e293b">📝 语音转文字</h2>
        <div style="white-space:pre-wrap">${transcriptText.trim()}</div>
        ${notesHtml ? `<h2 style="font-size:16px;border-bottom:2px solid #e2e8f0;padding-bottom:6px;margin:20px 0 12px;color:#1e293b">📖 随堂笔记</h2>${notesHtml}` : ''}
      `;
      document.body.appendChild(container);

      await html2pdf().set({
        margin: 0,
        filename: `${session.title}.pdf`,
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
      }).from(container).save();

      document.body.removeChild(container);
    } catch (err) {
      console.error('PDF export failed:', err);
    } finally {
      setIsExportingPDF(false);
      setShowExportMenu(false);
    }
  };

  const exportNotebookPackage = async () => {
    if (!notebook?.id) return;
    setIsExportingPackage(true);
    try {
      const pkg = await exportNotebook(notebook.id);
      const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `${notebook.title}.nootbook`;
      a.click();
      URL.revokeObjectURL(a.href);
    } catch (err: any) {
      console.error('Notebook package export failed:', err);
      alert(err.message || '导出失败');
    } finally {
      setIsExportingPackage(false);
      setShowExportMenu(false);
    }
  };

  return {
    state: {
      showExportMenu,
      isExportingPDF,
      isExportingPackage,
    },
    actions: {
      setShowExportMenu,
      exportMarkdown,
      exportPDF,
      exportNotebookPackage,
    },
  };
}
