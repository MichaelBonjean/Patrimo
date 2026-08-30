import React, { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import PullToRefresh from '@/components/ui/PullToRefresh';
import { base44 } from '@/api/base44Client';
import { Link, useNavigate } from 'react-router-dom';
import { Building2, Plus, MapPin, GripVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/lib/AuthContext';
import { canAddProperty } from '@/lib/planGate';
import UpgradeDialog from '@/components/UpgradeDialog';
import { Badge } from '@/components/ui/badge';
import { formatCurrency, calcTotalAcquisition, calcTotalMonthlyPayment } from '@/lib/formatters';
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd';
import { useOwnerFilter } from '@/lib/tenantFilter';
import OnboardingEmptyState from '@/components/OnboardingEmptyState';
import EmptyState from '@/components/EmptyState';
import { IlloBiens } from '@/components/illustrations/EmptyIllustrations';

export default function PropertyList() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [showUpgrade, setShowUpgrade] = useState(false);
  const [orderedProperties, setOrderedProperties] = useState([]);
  const { withOwner } = useOwnerFilter();

  const tryAddProperty = () => {
    if (canAddProperty(user, properties.length)) navigate('/biens/nouveau');
    else setShowUpgrade(true);
  };

  const handleRefresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['properties'] });
    await queryClient.invalidateQueries({ queryKey: ['lots'] });
    await queryClient.invalidateQueries({ queryKey: ['all-property-holders'] });
    await queryClient.invalidateQueries({ queryKey: ['holders'] });
  };

  const { data: properties = [], isLoading } = useQuery({
    queryKey: ['properties'],
    queryFn: () => base44.entities.Property.filter(withOwner()),
  });
  const { data: lots = [] } = useQuery({
    queryKey: ['lots'],
    queryFn: () => base44.entities.Lot.filter(withOwner()),
  });
  const { data: allLinks = [] } = useQuery({
    queryKey: ['all-property-holders'],
    queryFn: () => base44.entities.PropertyHolder.filter(withOwner()),
  });
  const { data: allHolders = [] } = useQuery({
    queryKey: ['holders'],
    queryFn: () => base44.entities.Holder.filter(withOwner()),
  });

  // Restore saved order from localStorage and sync with fetched properties
  useEffect(() => {
    if (properties.length === 0) return;
    const saved = localStorage.getItem('property-order');
    if (saved) {
      const savedOrder = JSON.parse(saved);
      const sorted = [...properties].sort((a, b) => {
        const ai = savedOrder.indexOf(a.id);
        const bi = savedOrder.indexOf(b.id);
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
      setOrderedProperties(sorted);
    } else {
      setOrderedProperties(properties);
    }
  }, [properties]);

  const handleDragEnd = (result) => {
    if (!result.destination) return;
    const items = Array.from(orderedProperties);
    const [moved] = items.splice(result.source.index, 1);
    items.splice(result.destination.index, 0, moved);
    setOrderedProperties(items);
    localStorage.setItem('property-order', JSON.stringify(items.map(p => p.id)));
  };

  const getPropertyHolderBadges = (propertyId) => {
    const links = allLinks.filter(l => l.property_id === propertyId);
    if (links.length === 0) return null;
    return links.map(l => {
      const h = allHolders.find(h => h.id === l.holder_id);
      return h ? { name: h.name, type: h.type, share: l.share_percent } : null;
    }).filter(Boolean);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="w-8 h-8 border-4 border-primary/20 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <PullToRefresh onRefresh={handleRefresh}>
    <div className="p-6 lg:p-8 space-y-6 max-w-[1600px]">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Mes biens</h1>
          <p className="text-sm text-muted-foreground mt-1">{properties.length} bien{properties.length > 1 ? 's' : ''} dans le patrimoine</p>
        </div>
        <div className="flex gap-2">
          <Button className="gap-2" onClick={tryAddProperty}><Plus className="w-4 h-4" />Ajouter un bien</Button>
        </div>
      </div>

      {properties.length === 0 ? (
        <EmptyState
          illustration={<IlloBiens />}
          title="Vous n'avez pas encore ajouté de bien"
          subtitle="Un bien = un lot ou un immeuble. Ajoutez votre premier patrimoine pour démarrer le suivi des loyers et des cash-flows."
          primary={<Link to="/biens/nouveau"><Button className="gap-2"><Plus className="w-4 h-4" />Ajouter mon premier bien</Button></Link>}
          secondary={<Link to="/onboarding"><Button variant="ghost" className="gap-2">Importer depuis Excel</Button></Link>}
        />
      ) : (
        <DragDropContext onDragEnd={handleDragEnd}>
          <Droppable droppableId="properties" direction="horizontal">
            {(provided) => (
              <div
                ref={provided.innerRef}
                {...provided.droppableProps}
                className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4"
              >
                {orderedProperties.map((property, index) => {
                  const propLots = lots.filter(l => l.property_id === property.id);
                  const occupiedLots = propLots.filter(l => !l.is_vacant);
                  const monthlyRent = occupiedLots.reduce((s, l) => s + (l.rent_excluding_charges || 0), 0);
                  const totalPayment = calcTotalMonthlyPayment(property);
                  const holderBadges = getPropertyHolderBadges(property.id);

                  return (
                    <Draggable key={property.id} draggableId={property.id} index={index}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.draggableProps}
                          className={`bg-card rounded-xl border border-border p-5 transition-all ${snapshot.isDragging ? 'shadow-2xl border-primary/50 rotate-1' : 'hover:shadow-lg hover:border-primary/30'}`}
                        >
                          <div className="flex items-start justify-between mb-3">
                            <div className="flex items-start gap-2 flex-1 min-w-0 mr-2">
                              <div
                                {...provided.dragHandleProps}
                                className="mt-0.5 text-muted-foreground/40 hover:text-muted-foreground cursor-grab active:cursor-grabbing shrink-0"
                              >
                                <GripVertical className="w-4 h-4" />
                              </div>
                              <Link to={`/biens/${property.id}`} className="flex-1 min-w-0 group">
                                <h3 className="font-semibold text-sm group-hover:text-primary transition-colors">{property.name}</h3>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground mt-1">
                                  <MapPin className="w-3 h-3" />
                                  <span>{property.city || 'Ville non renseignée'}</span>
                                </div>
                              </Link>
                            </div>
                            <div className="flex flex-col gap-1 items-end shrink-0">
                              {holderBadges && holderBadges.length > 0 ? (
                                holderBadges.map((h, i) => (
                                  <Badge key={i} variant="secondary" className="text-xs whitespace-nowrap">
                                    {h.name}{holderBadges.length > 1 ? ` ${h.share}%` : ''}
                                  </Badge>
                                ))
                              ) : (
                                <Badge variant="secondary" className="text-xs">{property.holding_structure}</Badge>
                              )}
                            </div>
                          </div>

                          <Link to={`/biens/${property.id}`} className="block">
                            <div className="grid grid-cols-3 gap-3 mt-4 pt-4 border-t border-border">
                              <div>
                                <p className="text-xs text-muted-foreground">Lots</p>
                                <p className="font-semibold text-sm">{propLots.length}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Loyer HC</p>
                                <p className="font-semibold text-sm text-emerald-600">{formatCurrency(monthlyRent)}</p>
                              </div>
                              <div>
                                <p className="text-xs text-muted-foreground">Cashflow</p>
                                <p className={`font-semibold text-sm ${(monthlyRent - totalPayment) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                                  {formatCurrency(monthlyRent - totalPayment, true)}
                                </p>
                              </div>
                            </div>
                          </Link>
                        </div>
                      )}
                    </Draggable>
                  );
                })}
                {provided.placeholder}
              </div>
            )}
          </Droppable>
        </DragDropContext>
      )}
      <UpgradeDialog open={showUpgrade} onClose={() => setShowUpgrade(false)} currentCount={properties.length} />
    </div>
    </PullToRefresh>
  );
}