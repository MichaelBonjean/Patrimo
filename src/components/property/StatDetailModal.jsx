import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export default function StatDetailModal({ open, onClose, title, rows }) {
  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 pt-1">
          {rows.map((row, i) => (
            <div key={i} className={`flex justify-between items-center py-2 ${i < rows.length - 1 ? 'border-b border-border' : ''} ${row.bold ? 'font-semibold' : ''}`}>
              <span className={`text-sm ${row.bold ? 'text-foreground' : 'text-muted-foreground'}`}>{row.label}</span>
              <span className={`text-sm font-medium ${row.color || ''}`}>{row.value}</span>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}