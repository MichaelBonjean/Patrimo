import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FileText, Download, Wallet, UserRound, Mail, MessageSquare, CheckCircle2,
  AlertCircle, Phone, Home, Send, ShieldCheck
} from 'lucide-react';
import { toast } from 'sonner';
import { buildSingleQuittance, periodLabel } from '@/lib/quittanceReport';
import { formatCurrency } from '@/lib/formatters';

function PortalLoading() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50">
      <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
    </div>
  );
}

function EmptyState({ icon: Icon, label }) {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
      <Icon className="w-8 h-8 mb-2 opacity-40" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

export default function TenantPortal() {
  const { token } = useParams();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [data, setData] = useState(null);

  // Coordonnées
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [savingCoords, setSavingCoords] = useState(false);

  // Incident
  const [incSubject, setIncSubject] = useState('');
  const [incDesc, setIncDesc] = useState('');
  const [sendingInc, setSendingInc] = useState(false);
  const [incSent, setIncSent] = useState(false);

  // Contact bailleur
  const [cMsg, setCMsg] = useState('');
  const [sendingContact, setSendingContact] = useState(false);
  const [contactSent, setContactSent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await base44.functions.invoke('tenantPortalAccess', { token });
        const d = res.data;
        if (cancelled) return;
        if (!d || !d.valid) {
          setError(d?.code || 'not_found');
        } else {
          setData(d);
          setPhone(d.tenant.phone || '');
          setEmail(d.tenant.email || '');
        }
      } catch (e) {
        if (!cancelled) setError('error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [token]);

  const downloadQuittance = (q) => {
    try {
      const row = {
        receipt_number: q.receipt_number,
        periodLabel: periodLabel(q.year, q.month),
        landlordName: q.landlord_name,
        landlordAddress: q.landlord_address,
        tenantName: q.tenant_name,
        tenantAddress: q.tenant_address,
        propertyName: q.property_name,
        lotDesignation: q.lot_designation,
        lotAddress: q.lot_address,
        rentHc: q.rent_hc,
        charges: q.charges,
        assurance: q.assurance,
        total: q.total,
        paymentMethod: q.payment_method,
        issueDate: q.issue_date
      };
      const doc = buildSingleQuittance(row);
      doc.save(`quittance_${q.period || (q.year + '-' + q.month)}.pdf`);
    } catch (e) {
      toast.error('Téléchargement impossible');
    }
  };

  const saveCoords = async () => {
    setSavingCoords(true);
    try {
      const res = await base44.functions.invoke('tenantPortalUpdate', { token, phone, email });
      if (res.data?.ok) {
        toast.success('Coordonnées mises à jour');
      } else {
        toast.error(res.data?.error || 'Mise à jour impossible');
      }
    } catch (e) {
      toast.error('Mise à jour impossible');
    } finally {
      setSavingCoords(false);
    }
  };

  const reportIncident = async () => {
    if (!incSubject.trim()) { toast.error('Merci de préciser un objet'); return; }
    setSendingInc(true);
    try {
      const res = await base44.functions.invoke('tenantPortalIncident', {
        token, subject: incSubject, description: incDesc
      });
      if (res.data?.ok) {
        toast.success('Signalement envoyé au bailleur');
        setIncSent(true);
        setIncSubject('');
        setIncDesc('');
      } else {
        toast.error(res.data?.error || 'Signalement impossible');
      }
    } catch (e) {
      toast.error('Signalement impossible');
    } finally {
      setSendingInc(false);
    }
  };

  const contactLandlord = async () => {
    if (!cMsg.trim()) { toast.error('Message vide'); return; }
    setSendingContact(true);
    try {
      const res = await base44.functions.invoke('tenantPortalContact', { token, message: cMsg });
      if (res.data?.ok) {
        toast.success('Message envoyé au bailleur');
        setContactSent(true);
        setCMsg('');
      } else {
        toast.error(res.data?.error || 'Envoi impossible');
      }
    } catch (e) {
      toast.error('Envoi impossible');
    } finally {
      setSendingContact(false);
    }
  };

  if (loading) return <PortalLoading />;

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
        <Card className="max-w-md w-full">
          <CardContent className="pt-6 text-center">
            <AlertCircle className="w-10 h-10 mx-auto mb-3 text-red-500" />
            <h1 className="text-lg font-semibold mb-1">
              {error === 'expired' ? 'Lien expiré'
                : error === 'revoked' ? 'Accès révoqué'
                : error === 'rate_limited' ? 'Trop de tentatives'
                : error === 'chain_broken' ? 'Accès invalide'
                : error === 'not_found' ? 'Lien invalide' : 'Accès indisponible'}
            </h1>
            <p className="text-sm text-muted-foreground">
              {error === 'expired' || error === 'revoked'
                ? "Ce lien n'est plus valide. Contactez votre bailleur pour obtenir un nouvel accès."
                : error === 'rate_limited'
                ? "Trop de tentatives répétées. Réessayez plus tard."
                : "Ce lien d'accès est introuvable, expiré ou révoqué."}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Header */}
      <header className="bg-slate-900 text-white">
        <div className="max-w-3xl mx-auto px-4 py-6">
          <div className="flex items-center gap-2 text-xs text-slate-300 mb-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            Espace locataire sécurisé
          </div>
          <h1 className="text-xl font-bold">Bonjour {data.tenant.name}</h1>
          <p className="text-sm text-slate-300 mt-0.5 flex items-center gap-1.5">
            <Home className="w-3.5 h-3.5" />
            {data.property.name} — {data.lot.designation}
            {data.lot.address && <span className="text-slate-400">· {data.lot.address}</span>}
          </p>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6">
        <Tabs defaultValue="quittances">
          <TabsList className="grid grid-cols-5 mb-4 w-full">
            <TabsTrigger value="quittances" className="text-xs"><FileText className="w-3.5 h-3.5 mr-1" />Quittances</TabsTrigger>
            <TabsTrigger value="paiements" className="text-xs"><Wallet className="w-3.5 h-3.5 mr-1" />Paiements</TabsTrigger>
            <TabsTrigger value="coordonnees" className="text-xs"><UserRound className="w-3.5 h-3.5 mr-1" />Coordonnées</TabsTrigger>
            <TabsTrigger value="incident" className="text-xs"><AlertCircle className="w-3.5 h-3.5 mr-1" />Incident</TabsTrigger>
            <TabsTrigger value="contact" className="text-xs"><Mail className="w-3.5 h-3.5 mr-1" />Contact</TabsTrigger>
          </TabsList>

          {/* Quittances */}
          <TabsContent value="quittances">
            <Card>
              <CardHeader><CardTitle className="text-base">Mes quittances de loyer</CardTitle></CardHeader>
              <CardContent>
                {data.quittances.length === 0 ? (
                  <EmptyState icon={FileText} label="Aucune quittance disponible pour le moment" />
                ) : (
                  <div className="space-y-2">
                    {data.quittances.map(q => (
                      <div key={q.id} className="flex items-center justify-between p-3 rounded-lg border bg-white">
                        <div className="min-w-0">
                          <p className="font-medium text-sm">{periodLabel(q.year, q.month)}</p>
                          <p className="text-xs text-muted-foreground">
                            {formatCurrency(q.total)} · Quittance n° {q.receipt_number || '—'}
                          </p>
                        </div>
                        <Button size="sm" variant="outline" onClick={() => downloadQuittance(q)}>
                          <Download className="w-3.5 h-3.5 mr-1" />PDF
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Paiements */}
          <TabsContent value="paiements">
            <Card>
              <CardHeader><CardTitle className="text-base">Historique des paiements encaissés</CardTitle></CardHeader>
              <CardContent>
                {data.payments.length === 0 ? (
                  <EmptyState icon={Wallet} label="Aucun paiement enregistré" />
                ) : (
                  <div className="divide-y divide-border">
                    {data.payments.map(p => (
                      <div key={p.id} className="flex items-center justify-between py-2.5">
                        <div>
                          <p className="text-sm font-medium">{p.date || 'Paiement'}</p>
                          <p className="text-xs text-muted-foreground">
                            {p.method ? `par ${p.method}` : ''}{p.reference ? ` · ${p.reference}` : ''}
                          </p>
                        </div>
                        <span className="text-sm font-semibold text-emerald-600 number-fr">{formatCurrency(p.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Coordonnées */}
          <TabsContent value="coordonnees">
            <Card>
              <CardHeader><CardTitle className="text-base">Mes coordonnées</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <Label className="text-xs">Email</Label>
                  <Input type="email" value={email} onChange={e => setEmail(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Téléphone</Label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <Input className="pl-9" value={phone} onChange={e => setPhone(e.target.value)} placeholder="06 ..." />
                  </div>
                </div>
                <Button onClick={saveCoords} disabled={savingCoords}>
                  {savingCoords ? 'Enregistrement…' : 'Enregistrer mes coordonnées'}
                </Button>
                <p className="text-xs text-muted-foreground flex items-start gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 text-emerald-500 shrink-0" />
                  Tenir vos coordonnées à jour permet à votre bailleur de joindre rapidement et de vous transmettre vos documents sans intermédiaire.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Incident */}
          <TabsContent value="incident">
            <Card>
              <CardHeader><CardTitle className="text-base">Signaler un problème</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {incSent ? (
                  <div className="flex flex-col items-center text-center py-6">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                    <p className="text-sm font-medium">Votre signalement a bien été transmis au bailleur.</p>
                    <Button variant="outline" className="mt-3" onClick={() => setIncSent(false)}>Signaler un autre problème</Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <Label className="text-xs">Objet *</Label>
                      <Input value={incSubject} onChange={e => setIncSubject(e.target.value)} placeholder="Fuite d'eau, chauffage en panne..." />
                    </div>
                    <div>
                      <Label className="text-xs">Description</Label>
                      <Textarea rows={5} value={incDesc} onChange={e => setIncDesc(e.target.value)} placeholder="Décrivez le problème et toute information utile (date d'apparition, urgence...)" />
                    </div>
                    <Button onClick={reportIncident} disabled={sendingInc}>
                      {sendingInc ? 'Envoi…' : 'Envoyer le signalement'}
                    </Button>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Contact */}
          <TabsContent value="contact">
            <Card>
              <CardHeader><CardTitle className="text-base">Contacter le bailleur</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                <div className="flex items-center gap-2 text-xs text-muted-foreground bg-emerald-50 border border-emerald-200 rounded-md p-2.5">
                  <MessageSquare className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  Vos messages sont transmis directement à {data.property.landlord_name || 'votre bailleur'}. L'adresse n'est pas affichée pour préserver sa vie privée.
                </div>
                {contactSent ? (
                  <div className="flex flex-col items-center text-center py-6">
                    <CheckCircle2 className="w-10 h-10 text-emerald-500 mb-2" />
                    <p className="text-sm font-medium">Message envoyé.</p>
                    <Button variant="outline" className="mt-3" onClick={() => setContactSent(false)}>Nouveau message</Button>
                  </div>
                ) : (
                  <>
                    <div>
                      <Label className="text-xs">Votre message</Label>
                      <Textarea rows={5} value={cMsg} onChange={e => setCMsg(e.target.value)} placeholder="Bonjour, je vous contacte au sujet de..." />
                    </div>
                    <Button onClick={contactLandlord} disabled={sendingContact || !data.property.contact_available}>
                      {sendingContact ? 'Envoi…' : <><Send className="w-3.5 h-3.5 mr-1" />Envoyer</>}
                    </Button>
                    {!data.property.contact_available && (
                      <p className="text-xs text-amber-600">Le bailleur n'a pas encore configuré d'adresse de contact.</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        <p className="text-center text-xs text-muted-foreground mt-6 flex items-center justify-center gap-1">
          <ShieldCheck className="w-3 h-3" />
          Accès protégé par jeton · valide 90 jours, révocable par le bailleur
        </p>
      </main>
    </div>
  );
}