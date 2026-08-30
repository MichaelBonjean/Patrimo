import React from 'react';
import { AlertTriangle, RefreshCw, LifeBuoy, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { captureComponentError } from '@/lib/sentry';
import { toast } from 'sonner';

const REPORT_BODY = (error, info, eventId) => [
  'Une erreur est survenue dans Patrimo.',
  '',
  `Message: ${error?.message || String(error)}`,
  eventId ? `Identifiant Sentry: ${eventId}` : '',
  '',
  '--- Stack ---',
  error?.stack || '',
  '',
  '--- Component stack ---',
  info?.componentStack || '',
  '',
  `Navigateur: ${navigator.userAgent}`,
  `URL: ${window.location.href}`,
  `Date: ${new Date().toISOString()}`,
].join('\n');

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      info: null,
      eventId: null,
      showDetails: false,
      copied: false,
    };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    const eventId = captureComponentError(error, info);
    this.setState({ info, eventId });
  }

  handleReload = () => window.location.reload();

  toggleDetails = () => this.setState((s) => ({ showDetails: !s.showDetails }));

  handleReport = async () => {
    const { error, info, eventId } = this.state;
    const body = REPORT_BODY(error, info, eventId);
    try {
      await navigator.clipboard.writeText(body);
      this.setState({ copied: true });
      toast.success('Rapport copié dans le presse-papiers');
    } catch {
      toast.error('Impossible de copier le rapport');
    }
    const subject = encodeURIComponent('[Patrimo] Signalement de bug');
    const encodedBody = encodeURIComponent(body);
    // recipient left blank so the builder fills in their support address
    window.location.href = `mailto:?subject=${subject}&body=${encodedBody}`;
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    const { error, info, showDetails, copied } = this.state;

    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="w-full max-w-lg rounded-xl border border-border bg-card shadow-sm p-8 text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
            <AlertTriangle className="h-7 w-7 text-destructive" />
          </div>
          <h1 className="text-xl font-semibold text-foreground">Une erreur est survenue</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Désolé pour la gêne. Rechargez la page pour continuer ; si le
            problème persiste, signalez-le à l'équipe.
          </p>

          <div className="mt-6 flex flex-col sm:flex-row gap-3 justify-center">
            <Button onClick={this.handleReload} className="gap-2">
              <RefreshCw className="h-4 w-4" />
              Recharger la page
            </Button>
            <Button variant="outline" onClick={this.handleReport} className="gap-2">
              {copied ? <Check className="h-4 w-4 text-success" /> : <LifeBuoy className="h-4 w-4" />}
              Signaler ce bug
            </Button>
          </div>

          <button
            onClick={this.toggleDetails}
            className="mt-6 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            Détails techniques
          </button>

          {showDetails && (
            <div className="mt-3 text-left">
              <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-3 text-xs text-muted-foreground whitespace-pre-wrap break-words font-mono">
                {error?.message || String(error)}
                {'\n\n'}
                {error?.stack || ''}
                {info?.componentStack ? `\n\nComponent stack:${info.componentStack}` : ''}
              </pre>
              <div className="mt-2 flex items-center justify-end gap-2">
                <span className="text-xs text-muted-foreground">
                  {copied ? 'Rapport copié' : "Copié lors du signalement"}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard
                      .writeText(REPORT_BODY(error, info, this.state.eventId))
                      .then(() => {
                        this.setState({ copied: true });
                        toast.success('Rapport copié');
                      })
                      .catch(() => toast.error('Copie impossible'));
                  }}
                  className="gap-1 h-7"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Copier
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}