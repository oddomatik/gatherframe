<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import BottomSheet from '$lib/components/BottomSheet.svelte';
  import PreviewFrame from '$lib/components/PreviewFrame.svelte';
  import PrintReview from '$lib/components/PrintReview.svelte';
  import { photoUrl, photoShareUrl, sharePhoto, loadFavorites } from '$lib/client/photos';
  import { api, ApiError } from '$lib/client/api';
  import { clearCart, emptyCart, itemKey, loadCart, saveCart, stageOrder, recoverPhotoChoices, type StoredCart } from '$lib/client/cart';
  import { toast } from '$lib/client/toast.svelte';
  import { contentsSummary, type Catalog, type Product, type SheetTemplate } from '$shared/catalog';
  import { formatCents } from '$shared/money';
  import { priceCart, type CartItem, type PricedCart } from '$shared/pricing';
  import { groupPrints, printCount, slotsForItem, type PrintSlot } from '$shared/prints';
  import type { PublicPhoto } from '$server/public';

  interface Props {
    event: { id: number; slug: string; name: string; subjectLabel: string };
    gallery: { id: number; publicId: string; name?: string };
    photos: PublicPhoto[];
    siblings: { id: number; publicId: string; coverUrl: string | null; photoCount: number; photoIds?: number[] }[];
    catalog: Catalog;
    initialPhotoId: number | null;
    studio: { name: string; currency: string };
    demo?: boolean;
    venmoAvailable?: boolean;
    fromFavorites?: boolean; emailUpdatesAvailable?: boolean;
  }
  let { event, gallery, photos, siblings, catalog, initialPhotoId, studio, demo = false, venmoAvailable = false, fromFavorites = false, emailUpdatesAvailable = false }: Props = $props();

  type Step = 'choose' | 'fill' | 'cart' | 'checkout';
  let step = $state<Step>('choose');
  let favoritesLoading = $state(false), favoritesError = $state(false);
  let quickChoices = $state<Record<number,{productId:number;quantity:number}>>({});
  let cart = $state<StoredCart>(emptyCart());
  let loaded = $state(false);
  let editing = $state<string | null>(null);
  let picker = $state<{ open: boolean; mode: 'all' | 'cell' | 'remaining'; sheetIdx: number; cellIndex: number }>({ open: false, mode: 'all', sheetIdx: 0, cellIndex: 0 });
  let pickerTab = $state(untrack(() => gallery.publicId));
  let galleryPhotos = $state<Record<string, PublicPhoto[]>>(untrack(() => ({ [gallery.publicId]: photos })));
  let photoIndex = $state<Record<number, PublicPhoto>>(untrack(() => Object.fromEntries(photos.map((p) => [p.id, p]))));
  let confirmAll = $state<{ photoId: number } | null>(null);
  type AcceptedQuote = PricedCart & { quoteToken: string };
  let serverQuote = $state<AcceptedQuote | null>(null);
  let quoteLoading = $state(false);
  let quoteError = $state('');
  let quoteChanged = $state(false);
  let refreshingPreviews = $state(false);
  let optionsNeedReload = $state(false);
  let acceptedChangedPrice = $state(false);
  let pickerInspect = $state<PublicPhoto | null>(null);
  let galleryErrors = $state<Record<string, boolean>>({});
  let favorites = $state<Set<number>>(new Set());
  let favoritesOnly = $state(false);
  const pickerPhotos = $derived((galleryPhotos[pickerTab] ?? []).filter(p => !favoritesOnly || favorites.has(p.id)));
  const inspectIndex = $derived(pickerPhotos.findIndex(p => p.id === pickerInspect?.id));
  function stepInspect(direction: number) { if (pickerPhotos.length && inspectIndex >= 0) pickerInspect = pickerPhotos[(inspectIndex + direction + pickerPhotos.length) % pickerPhotos.length]; }
  let recoveryPending = $state(false);
  let submitting = $state(false);
  let submitError = $state<string | null>(null);

  const packages = $derived(catalog.products.filter((p) => p.kind === 'package' && p.active));
  const singles = $derived(catalog.products.filter((p) => p.kind === 'single' && p.active));
  const quickProducts = $derived(singles.filter(p=>printCount(p,catalog)===1 && p.sheets.every(s=>catalog.sheets[s.templateCode]?.cells.every(c=>(c.sizeOptions?.length??0)<=1))));
  const favoritePhotos = $derived(Object.values(photoIndex).filter(p=>favorites.has(p.id)));
  const orderedPhotoIds = $derived([...new Set(cart.items.flatMap(i=>i.sheets.flatMap(s=>s.cells.flatMap(c=>c.photoId==null?[]:[c.photoId]))))]);
  const local = $derived(priceCart(cart.items, catalog));
  const current = $derived(editing ? cart.items.find((i) => i.key === editing) ?? null : null);
  const currentProduct = $derived(current ? catalog.products.find((p) => p.id === current.productId) ?? null : null);
  const currentSlots = $derived(current ? slotsForItem(current, catalog) : []);
  const currentGroups = $derived(groupPrints(currentSlots, catalog));
  const currentFilled = $derived(currentSlots.length > 0 && currentSlots.every((s) => s.photoId != null));
  const currentCount = $derived(currentSlots.length);
  const itemCount = $derived(cart.items.reduce((n, i) => n + i.quantity, 0));

  onMount(async () => {
    cart = loadCart(event.id);
    favorites = loadFavorites(event.id);
    const recovered = await recoverPhotoChoices(cart.items, photos, siblings.filter(g => g.publicId !== gallery.publicId).map(g => g.publicId), async pid => {
      const response = await api<{ photos: PublicPhoto[] }>(`/g/${event.slug}/api/photos?g=${encodeURIComponent(pid)}`);
      galleryPhotos[pid] = response.photos;
      return response.photos;
    });
    for (const p of recovered.photos) photoIndex[p.id] = p;
    for (const pid of recovered.failedCollections) galleryErrors[pid] = true;
    recoveryPending = recovered.unresolvedIds.length > 0;
    if (recoveryPending) toast('Your saved choices are kept. Some previews could not be loaded; retry before reviewing your order.', 'error');
    if (cart.pendingOrder) { serverQuote = cart.pendingQuote ?? null; cart.items = cart.pendingOrder.cart; const frozen=cart.pendingOrder.customer; cart.customer={name:frozen.name,phone:frozen.phone??'',email:frozen.email??'',subjectName:frozen.subjectName??'',notes:frozen.notes??'',photoRequests:frozen.photoRequests??{},emailUpdates:!!frozen.emailUpdates}; step = 'checkout'; loaded = true; return; }
    if (cart.items.some((i) => !catalog.products.some((p) => p.id === i.productId && p.active))) { step = 'cart'; toast('An offering has changed. Your saved photo choices are still here; choose a current offering and remove the old one when ready.', 'error'); }
    loaded = true;
    if (fromFavorites) void loadFavoritePhotos();
  });

  $effect(() => { if (loaded) saveCart(event.id, JSON.parse(JSON.stringify(cart))); });

  async function ensureGallery(pid: string) {
    if (galleryPhotos[pid]) return;
    galleryErrors[pid] = false;
    try {
      const r = await api<{ photos: PublicPhoto[] }>(`/g/${event.slug}/api/photos?g=${encodeURIComponent(pid)}`);
      galleryPhotos[pid] = r.photos;
      for (const p of r.photos) photoIndex[p.id] = p;
    } catch { galleryErrors[pid] = true; toast('Could not load those photos. Your selections have been kept.', 'error'); }
  }

  async function loadFavoritePhotos() {
    favoritesLoading=true; favoritesError=false;
    // Fetch only collections containing unseen favorite IDs when metadata is available; older clients can fetch all.
    const remaining=siblings.filter(g=>!galleryPhotos[g.publicId] && (!g.photoIds || g.photoIds.some(id=>favorites.has(id))));
    for (let i=0;i<remaining.length;i+=4) await Promise.all(remaining.slice(i,i+4).map(g=>ensureGallery(g.publicId)));
    favoritesError=remaining.some(g=>galleryErrors[g.publicId]); favoritesLoading=false;
  }
  function addFavorite(photo:PublicPhoto) {
    const choice=quickChoices[photo.id] ?? {productId:quickProducts[0]?.id,quantity:1};
    const product=quickProducts.find(p=>p.id===Number(choice.productId));
    if(!product || cart.pendingOrder)return;
    const quantity=Math.max(1,Math.min(50,Math.floor(Number(choice.quantity)||1)));
    cart.items.push({key:itemKey(),productId:product.id,quantity,sheets:product.sheets.map(ps=>({templateCode:ps.templateCode,cells:sheetTemplate(ps.templateCode).cells.map(c=>({cellIndex:c.cellIndex,photoId:photo.id,sizeChoice:c.sizeOptions?.[0]??null}))}))});
    toast(`Added ${quantity} × ${product.name} for Photo ${photo.id}`,'success');
  }
  function printsInCart(id:number) { return cart.items.reduce((total,item)=>total+item.quantity*item.sheets.reduce((n,s)=>n+s.cells.filter(c=>c.photoId===id).length,0),0); }
  function quickChoice(id:number) { return quickChoices[id] ?? {productId:quickProducts[0]?.id,quantity:1}; }
  function requestFor(id:number) { return (cart.pendingOrder ? cart.pendingOrder.customer.photoRequests?.[String(id)] : cart.customer.photoRequests?.[String(id)]) ?? '';  }
  function setRequest(id:number,note:string) { cart.customer.photoRequests={...cart.customer.photoRequests,[String(id)]:note}; }

  function sheetTemplate(code: string): SheetTemplate { return catalog.sheets[code]; }

  function addProduct(product: Product) {
    const item: CartItem = {
      key: itemKey(), productId: product.id, quantity: 1,
      sheets: product.sheets.map((ps) => ({ templateCode: ps.templateCode, cells: sheetTemplate(ps.templateCode).cells.map((c) => ({ cellIndex: c.cellIndex, photoId: null, sizeChoice: c.sizeOptions?.length ? c.sizeOptions[0] : null })) }))
    };
    const prefill = initialPhotoId && photoIndex[initialPhotoId] ? initialPhotoId : null;
    if (prefill) for (const s of item.sheets) for (const c of s.cells) c.photoId = prefill;
    cart.items.push(item);
    editing = item.key;
    step = 'fill';
    confirmAll = null;
    if (prefill) toast(`Added ${product.name}. Tap any print to change its photo.`, 'success');
    else if (printCount(product, catalog) === 1) openPicker('all');
  }

  function openPicker(mode: 'all' | 'cell' | 'remaining', sheetIdx = 0, cellIndex = 0) {
    picker = { open: true, mode: currentProduct?.allowMultiPose === false ? 'all' : mode, sheetIdx, cellIndex };
    pickerTab = gallery.publicId; pickerInspect = null; favoritesOnly = fromFavorites;
  }

  function assign(photoId: number) {
    if (!current) return;
    if (picker.mode === 'all') { for (const s of current.sheets) for (const c of s.cells) c.photoId = photoId; }
    else if (picker.mode === 'remaining') { for (const s of current.sheets) for (const c of s.cells) if (c.photoId == null) c.photoId = photoId; }
    else {
      const wasEmptyElsewhere = current.sheets.every((s, si) => s.cells.every((c) => (si === picker.sheetIdx && c.cellIndex === picker.cellIndex) || c.photoId == null));
      const cell = current.sheets[picker.sheetIdx].cells.find((c) => c.cellIndex === picker.cellIndex);
      if (cell) cell.photoId = photoId;
      if (wasEmptyElsewhere && currentCount > 1) confirmAll = { photoId };
    }
    picker.open = false;
  }

  function applyAll(photoId: number) { if (current) for (const s of current.sheets) for (const c of s.cells) c.photoId = photoId; confirmAll = null; }
  function setSize(slot: PrintSlot, size: string) { const cell = current?.sheets[slot.sheetIdx].cells.find((c) => c.cellIndex === slot.cellIndex); if (cell) cell.sizeChoice = size; }

  function removeItem(key: string) { cart.items = cart.items.filter((i) => i.key !== key); if (editing === key) editing = null; if (!cart.items.length) step = 'choose'; else if (!editing) step = 'cart'; }
  function setQty(item: CartItem, n: number) { item.quantity = Math.max(1, Math.min(50, n)); }
  function cloneItem(item: CartItem) {
    const product = catalog.products.find((p) => p.id === item.productId && p.active);
    if (product) addProduct(product); else { step = 'choose'; toast('Choose one of the current print offerings. Your previous choices are kept in the cart.', 'error'); }
  }
  function editItem(key: string) { editing = key; step = 'fill'; }
  function doneFilling() { if (!currentFilled) { toast('Choose a photo for every print first', 'error'); return; } editing = null; step = 'cart'; }


  async function goCheckout() {
    step = 'checkout'; submitError = null; quoteLoading = true; quoteError = ''; serverQuote = null; acceptedChangedPrice = false;
    try {
      serverQuote = await api<AcceptedQuote>(`/g/${event.slug}/api/quote`, { method: 'POST', json: { cart: cart.items } });
      optionsNeedReload = !serverQuote.complete && serverQuote.items.some((i) => i.problems.some((p) => /layout|count does not match|no longer available|size is not available|position is not available/i.test(p)));
      quoteChanged = serverQuote.totalCents !== local.totalCents || serverQuote.items.some(i => i.unitPriceCents !== local.items.find(x => x.key === i.key)?.unitPriceCents);
    } catch (err) { quoteError = err instanceof Error ? err.message : 'Could not confirm the price. Please try again.'; }
    finally { quoteLoading = false; }
  }

  async function refreshReviewPhotos() {
    refreshingPreviews = true;
    const collectionIds = [...new Set([gallery.publicId, ...Object.keys(galleryPhotos), ...siblings.map((g) => g.publicId)])];
    const refreshed: Record<number, PublicPhoto> = {};
    const results = await Promise.allSettled(collectionIds.map(async (pid) => {
      const r = await api<{ photos: PublicPhoto[] }>(`/g/${event.slug}/api/photos?g=${encodeURIComponent(pid)}`);
      galleryPhotos[pid] = r.photos; galleryErrors[pid] = false;
      for (const p of r.photos) { refreshed[p.id] = p; photoIndex[p.id] = p; }
    }));
    results.forEach((result, index) => { if (result.status === 'rejected') galleryErrors[collectionIds[index]] = true; });
    recoveryPending = cart.items.some(i => i.sheets.some(s => s.cells.some(c => c.photoId != null && !refreshed[c.photoId])));
    refreshingPreviews = false;
  }
  function reloadOptions() { if (saveCart(event.id, cart)) window.location.reload(); else toast('Please allow site storage before reloading so your choices can be kept.', 'error'); }
  async function retryPreviews() {
    if (quoteChanged) { await refreshReviewPhotos(); return; }
    for (const g of siblings) if (!galleryPhotos[g.publicId]) await ensureGallery(g.publicId);
    recoveryPending = cart.items.some(i => i.sheets.some(s => s.cells.some(c => c.photoId != null && !photoIndex[c.photoId])));
    if (recoveryPending) toast('Some previews are still unavailable. Your choices are kept; the photographer may be updating them.', 'error');
  }
  function parentProblem(message: string): string {
    return /sheet|cell|layout|template/i.test(message) ? 'The available prints have changed. Refresh print options, then choose the current offering. Your earlier photo choices are kept for reference.' : message;
  }

  async function submit(ev: SubmitEvent) {
    ev.preventDefault();
    submitError = null;
    if (demo) { submitError = 'This demo does not accept orders.'; return; }
    if (!cart.customer.name.trim()) { submitError = 'Please enter your name.'; return; }
    if (!cart.customer.phone.trim() && !cart.customer.email.trim()) { submitError = 'We need one way to reach you: a phone number or an email.'; return; }
    if (!cart.pendingOrder && cart.customer.emailUpdates && !cart.customer.email.trim()) { submitError = 'Enter your email address to receive order updates.'; return; }
    if (!cart.pendingOrder && (refreshingPreviews || recoveryPending || !serverQuote?.quoteToken || !serverQuote.complete || (quoteChanged && !acceptedChangedPrice))) { submitError = 'Please confirm the current order total before placing your order.'; return; }
    if (!cart.pendingOrder && !stageOrder(event.id, cart, serverQuote!)) {
      submitError = 'This browser could not save your order for recovery, so it has not been sent. Please allow site storage or free some space, then try again.';
      return;
    }
    submitting = true;
    try {
      const r = await api<{ ok: boolean; orderNumber: string; url: string }>(`/g/${event.slug}/api/orders`, {
        method: 'POST', json: cart.pendingOrder
      });
      clearCart(event.id);
      loaded = false;
      await goto(`${r.url}?new=1`).catch(() => { window.location.assign(`${r.url}?new=1`); });
    } catch (err) {
      submitError = err instanceof ApiError ? err.message : 'Could not place the order. Please try again.';
      if (err instanceof ApiError && err.status === 409 && (err.details as { quote?: AcceptedQuote })?.quote) {
        cart.pendingOrder = undefined; cart.pendingQuote = undefined; serverQuote = (err.details as { quote: AcceptedQuote }).quote; quoteChanged = true; acceptedChangedPrice = false;
        submitError = 'The photographer updated a photo, print option or price. Please review the refreshed photos and order details below, then confirm again.';
        await refreshReviewPhotos();
      } else if (err instanceof ApiError && err.status === 400) {
        cart.pendingOrder = undefined; cart.pendingQuote = undefined;
        const review = (err.details as { details?: AcceptedQuote })?.details;
        if (review?.items) { serverQuote = review; optionsNeedReload = true; submitError = 'The available print options changed. Refresh them before rebuilding this item; your saved photo choices are kept.'; }
      }
    } finally { submitting = false; }
  }

  const label = $derived(event.subjectLabel || 'child');
</script>

<div class="mx-auto max-w-2xl px-4 pb-32 pt-4" inert={!loaded}>
  <nav class="mb-3 flex items-center gap-2 text-sm text-stone-600">
    <a href={`/g/${event.slug}/c/${gallery.publicId}`} class="rounded px-1 hover:underline">← Back to photos</a>
    <span class="ml-auto flex gap-1 text-xs">
      {#each ['choose', 'fill', 'cart', 'checkout'] as s, i (s)}
        <span class={`h-2 w-2 rounded-full ${step === s ? 'bg-amber-500' : i < ['choose', 'fill', 'cart', 'checkout'].indexOf(step) ? 'bg-stone-800' : 'bg-stone-300'}`}></span>
      {/each}
    </span>
  </nav>

  {#if step === 'choose'}
    <p class="eyebrow">{event.name} / prints</p>
    <h1 class="display-title mt-2 text-4xl sm:text-5xl">{fromFavorites?'Print your favorites.':'Choose your prints.'}</h1>
    {#if fromFavorites}
      <section class="mt-5" aria-label="Favorite prints">
        <p class="text-sm text-stone-600">Choose sizes and quantities below. Shared photos appear once, and everything goes into the same order.</p>
        {#if favoritesLoading}<p role="status" class="mt-3 text-sm">Loading your favorites across collections…</p>{/if}
        {#if favoritesError}<p role="alert" class="mt-3 text-sm">Some collections could not load. Your cart is unchanged. <button type="button" class="underline" onclick={loadFavoritePhotos}>Retry favorites</button></p>{/if}
        <div class="mt-4 grid gap-4 sm:grid-cols-2">
          {#each favoritePhotos as p (p.id)}
            <article class="photo-card overflow-hidden p-3" aria-label={`Favorite Photo ${p.id}`}>
              <img src={photoUrl(p,'preview')} alt={`Photo ${p.id}`} class="aspect-[4/5] w-full rounded-lg bg-stone-50 object-contain" loading="lazy" />
              <p class="mt-2 text-sm font-medium">Photo {p.id}</p>{#if printsInCart(p.id)}<p class="mt-1 text-xs text-emerald-800">{printsInCart(p.id)} print{printsInCart(p.id)===1?'':'s'} in your order</p>{/if}
              {#if quickProducts.length}
                <label class="mt-2 block text-sm">Print size<select class="mt-1 w-full rounded-lg border border-stone-300 bg-white p-3" value={quickChoice(p.id).productId} onchange={e=>quickChoices[p.id]={...quickChoice(p.id),productId:Number(e.currentTarget.value)}}>{#each quickProducts as product}<option value={product.id}>{product.name} · {contentsSummary(product,catalog)} · {formatCents(product.priceCents,catalog.currency)}</option>{/each}</select></label>
                <label class="mt-2 block text-sm">Quantity<input type="number" min="1" max="50" step="1" class="mt-1 w-full rounded-lg border border-stone-300 p-3" value={quickChoice(p.id).quantity} onchange={e=>quickChoices[p.id]={...quickChoice(p.id),quantity:Number(e.currentTarget.value)}} /></label>
                <button type="button" class="button-primary mt-3 w-full" onclick={()=>addFavorite(p)}>Add to order</button>
              {:else}<p class="mt-2 text-sm">Choose a package below and use the favorites filter when selecting photos.</p>{/if}
            </article>
          {/each}
        </div>
        {#if !favoritesLoading&&!favoritePhotos.length}<p class="notice mt-3">No saved favorites are available in this browser. Go back to the photos and tap a heart, or choose prints below.</p>{/if}
      </section>
    {/if}
    <p class="mt-1 text-sm text-stone-600">Pick a package or single prints, then choose which photo goes on each print. Pick your favorites, including friends and siblings.</p>

    {#if packages.length}
      <h2 class="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Packages</h2>
      <ul class="space-y-3">
        {#each packages as p (p.id)}
          {@render productCard(p)}
        {/each}
      </ul>
    {/if}
    {#if singles.length}
      <h2 class="mt-6 mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Single prints</h2>
      <ul class="space-y-3">
        {#each singles as p (p.id)}
          {@render productCard(p)}
        {/each}
      </ul>
    {/if}

  {:else if step === 'fill' && current && currentProduct}
    <div class="flex items-baseline justify-between">
      <h1 class="text-xl font-semibold">{currentProduct.name}</h1>
      <span class="font-medium">{formatCents(currentProduct.priceCents, catalog.currency)}</span>
    </div>
    <p class="mt-1 text-sm text-stone-600">{currentCount === 1 ? 'Choose the photo for this print.' : !currentProduct.allowMultiPose ? 'Choose one favorite photo for all the prints in this package.' : 'Choose the photo for each print. Tap a print to pick or change its photo.'}</p>

    {#if confirmAll}
      <div class="mt-3 flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
        <img src={photoUrl(photoIndex[confirmAll.photoId])} alt="" class="h-10 w-10 rounded object-cover" />
        <span class="flex-1">Use this photo for all {currentCount} prints?</span>
        <button type="button" class="rounded bg-stone-900 px-3 py-1.5 text-white" onclick={() => applyAll(confirmAll!.photoId)}>Yes</button>
        <button type="button" class="rounded border border-stone-300 px-3 py-1.5" onclick={() => (confirmAll = null)}>No</button>
      </div>
    {/if}

    <div class="mt-4 flex flex-wrap gap-2">
      <button type="button" class="rounded-lg bg-stone-900 px-3 py-2 text-sm font-medium text-white" onclick={() => openPicker('all')}>{currentCount > 1 ? 'Use one pose for all prints' : 'Pick the photo'}</button>
      {#if currentCount > 1 && !currentFilled && currentSlots.some((s) => s.photoId != null)}
        <button type="button" class="rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" onclick={() => openPicker('remaining')}>Fill the empty prints</button>
      {/if}
    </div>

    <div class="mt-4 space-y-4">
      {#each currentGroups as group (group.key)}
        <section>
          <h2 class="mb-2 text-sm font-medium">{group.label} <span class="font-normal text-stone-500">· {group.count} print{group.count === 1 ? '' : 's'}</span></h2>
          {#if group.key === 'display'}
            {@const slot = group.prints[0]}
            <div class="mb-2 flex items-center gap-2 text-sm">
              <span class="text-stone-600">Size:</span>
              {#each slot.sizeOptions ?? [] as opt (opt)}
                <button type="button" class={`rounded-full border px-3 py-1 ${slot.sizeChoice === opt ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-300 bg-white'}`} onclick={() => setSize(slot, opt)}>{opt}</button>
              {/each}
            </div>
          {/if}
          <div class={`grid gap-2 ${group.count >= 4 ? 'grid-cols-4' : group.count >= 2 ? 'grid-cols-3' : 'grid-cols-3'}`}>
            {#each group.prints as slot, n (slot.sheetIdx + ':' + slot.cellIndex)}
              {@const p = slot.photoId != null ? photoIndex[slot.photoId] : null}
              <button type="button" class={`flex aspect-[4/5] items-center justify-center overflow-hidden rounded-lg border ${p ? 'border-stone-300 bg-stone-100' : 'border-dashed border-stone-400 bg-stone-50'} ${group.count === 1 ? 'col-span-1' : ''}`}
                aria-label={`${group.label === 'Wallets' ? 'wallet' : group.label} print ${n + 1}${p ? `: photo ${p.id}` : ': choose a photo'}`}
                onclick={() => openPicker('cell', slot.sheetIdx, slot.cellIndex)}>
                {#if p}
                  <img src={photoUrl(p)} alt="" class="h-full w-full object-contain" loading="lazy" draggable="false" />
                {:else}
                  <span class="text-2xl text-stone-400">+</span>
                {/if}
              </button>
            {/each}
          </div>
        </section>
      {/each}
    </div>

    <div class="mt-5 flex items-center justify-between rounded-lg border border-stone-200 bg-white p-3">
      <span class="text-sm">Quantity</span>
      <div class="flex items-center gap-3">
        <button type="button" class="h-9 w-9 rounded-full border border-stone-300 text-lg" aria-label="Fewer" onclick={() => setQty(current!, current!.quantity - 1)}>−</button>
        <span class="w-6 text-center font-medium">{current.quantity}</span>
        <button type="button" class="h-9 w-9 rounded-full border border-stone-300 text-lg" aria-label="More" onclick={() => setQty(current!, current!.quantity + 1)}>+</button>
      </div>
    </div>
    <p class="mt-2 text-xs text-stone-500">Quantity repeats these exact photos. Want the same package with different photos? Finish this one, then use "Add another with different photos" in your order.</p>
    <button type="button" class="mt-3 text-sm text-red-700 underline" onclick={() => removeItem(current!.key)}>Remove this item</button>

  {:else if step === 'cart'}
    <h1 class="text-2xl font-semibold">Your order</h1>
    {#if cart.items.length === 0}
      <p class="mt-4 text-stone-600">Your keepsakes start with a favorite photo.</p><button type="button" class="button-primary mt-4" onclick={() => step = 'choose'}>Choose prints</button>
    {:else}
      <ul class="mt-4 space-y-3">
        {#each local.items as pi (pi.key)}
          {@const item = cart.items.find((i) => i.key === pi.key)!}
          {@const product = catalog.products.find((p) => p.id === item.productId)}
          <li class="rounded-xl border border-stone-200 bg-white p-3">
            <div class="flex items-baseline justify-between gap-2">
              <span class="font-medium">{pi.quantity}× {pi.productName}</span>
              <span class="font-medium">{formatCents(pi.totalCents, catalog.currency)}</span>
            </div>
            {#if product}<p class="text-xs text-stone-500">{contentsSummary(product, catalog)}</p>{/if}
            <PrintReview slots={slotsForItem(item, catalog)} photos={photoIndex} {catalog} quantity={item.quantity} />
            {#if pi.problems.length}<p class="mt-1 text-xs text-red-700">{pi.problems.map(parentProblem).join('. ')}</p>{/if}
            <div class="mt-2 flex flex-wrap gap-3 text-sm">
              <button type="button" class="underline" onclick={() => editItem(item.key)}>Edit photos</button>
              <button type="button" class="underline" onclick={() => cloneItem(item)}>Add another with different photos</button>
              <button type="button" class="text-red-700 underline" onclick={() => removeItem(item.key)}>Remove</button>
            </div>
          </li>
        {/each}
      </ul>
      <button type="button" class="mt-4 rounded-lg border border-stone-300 bg-white px-3 py-2 text-sm" onclick={() => (step = 'choose')}>+ Add more</button>
    {/if}

  {:else if step === 'checkout'}
    <h1 class="text-2xl font-semibold">{demo ? 'Sample order preview' : 'Almost done'}</h1>
    {#if demo}<p class="notice mt-4">This is a preview only. No contact details or payments are collected, and no order will be submitted.</p>{:else}
    <p class="mt-1 text-sm text-stone-600">Tell us who this order is for and how to reach you.</p>
    <section class="mt-4 grid gap-3 sm:grid-cols-2" aria-label="Payment options">
      <div class="rounded-xl border border-emerald-300 bg-emerald-50 p-4">
        <h2 class="font-semibold text-emerald-950">Pay cash in person</h2>
        <p class="mt-1 text-sm text-emerald-900">Place your order now. Pay the photographer in person.</p>
      </div>
      {#if venmoAvailable}
        <div class="rounded-xl border border-sky-200 bg-sky-50 p-4">
          <h2 class="font-semibold text-sky-950">Pay with Venmo</h2>
          <p class="mt-1 text-sm text-sky-900">Payment details appear after you place your order.</p>
        </div>
      {/if}
    </section>
    <form class="mt-4 space-y-3" onsubmit={submit} id="checkout">
      <fieldset disabled={!!cart.pendingOrder} class="space-y-3 disabled:opacity-70">
      <label class="block text-sm">Your name <span class="text-red-600">*</span>
        <input class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-3 text-base" bind:value={cart.customer.name} autocomplete="name" required />
      </label>
      <div class="grid gap-3 sm:grid-cols-2">
        <label class="block text-sm">Phone
          <input class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-3 text-base" bind:value={cart.customer.phone} type="tel" autocomplete="tel" inputmode="tel" />
        </label>
        <label class="block text-sm">Email
          <input class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-3 text-base" bind:value={cart.customer.email} type="email" autocomplete="email" inputmode="email" />
        </label>
      </div>
      <p class="-mt-1 text-xs text-stone-500">We need one way to reach you. If email receipts are available, we will send one to the address you provide. Your confirmation link will always be available after ordering.</p>
      {#if emailUpdatesAvailable}<label class="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" bind:checked={cart.customer.emailUpdates} />Email me when my prints are printed or delivered</label>{/if}
      <label class="block text-sm">{label[0].toUpperCase() + label.slice(1)} name(s)
        <input class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-3 text-base" bind:value={cart.customer.subjectName} placeholder="Who are these lovely photos for?" />
      </label>
      <label class="block text-sm">Notes for the photographer
        <textarea class="mt-1 w-full rounded-lg border border-stone-300 px-3 py-2 text-base" rows="2" bind:value={cart.customer.notes}></textarea>
      </label>
      <details class="rounded-xl border border-stone-200 p-3" open={Object.values(cart.customer.photoRequests??{}).some(Boolean)}>
        <summary class="cursor-pointer py-2 font-medium">Requests for specific photos (optional)</summary>
        <p class="mt-2 text-sm text-stone-600">For example, a touch-up or crop preference. The photographer reviews requests before printing.</p>
        {#each orderedPhotoIds as id (id)}<div class="mt-3 flex items-start gap-3">{#if photoIndex[id]}<img src={photoUrl(photoIndex[id],'thumb')} alt="" class="h-28 w-24 shrink-0 rounded-lg bg-stone-50 object-contain" loading="lazy" />{/if}<label class="min-w-0 flex-1 text-sm">Request for Photo {id}<textarea maxlength="500" rows="3" class="mt-1 block w-full rounded-lg border border-stone-300 p-2" bind:value={()=>requestFor(id), value=>setRequest(id,value)}></textarea></label></div>{/each}
      </details>
      <input type="text" name="website" tabindex="-1" autocomplete="off" class="hidden" aria-hidden="true" />
      </fieldset>
      {#if submitError}<p role="alert" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{submitError}</p>{/if}
      {#if cart.pendingOrder}<div role="status" class="notice text-sm"><strong>Let’s make sure this order arrived.</strong><p class="mt-1">Your exact order is saved in this browser. Retry it to find the confirmation or finish placing it, without placing a second order. Editing is paused until we know the result.</p></div>{/if}
    </form>
    {/if}

    <div class="mt-5 rounded-xl border border-stone-200 bg-white p-3 text-sm">
      {#each (serverQuote ?? local).items as pi (pi.key)}
        <div class="mt-3 flex justify-between py-1"><span>{pi.quantity}× {pi.productName}</span><span>{formatCents(pi.totalCents, catalog.currency)}</span></div>
        {@const reviewItem = cart.items.find(i => i.key === pi.key)}
        {#if reviewItem}<PrintReview slots={slotsForItem(reviewItem, catalog)} photos={photoIndex} {catalog} quantity={reviewItem.quantity} />{/if}
        {#if pi.problems.length}<p class="mt-2 text-sm text-red-700">{pi.problems.map(parentProblem).join('. ')}</p>{/if}
      {/each}
      <div class="mt-2 flex justify-between border-t border-stone-200 pt-2 text-base font-semibold"><span>Total</span><span>{formatCents((serverQuote ?? local).totalCents, catalog.currency)}</span></div>
      <p class="mt-2 text-xs text-stone-500">{demo ? 'Illustrative pricing only.' : 'Placing your order does not charge you.'}</p>
    </div>
    {#if quoteLoading}<p role="status" class="mt-3 text-sm text-stone-600">Confirming the current price…</p>{/if}
    {#if quoteError}<div role="alert" class="mt-3 rounded-xl bg-red-50 p-4 text-sm text-red-700">{quoteError}<button type="button" class="button-secondary mt-2" onclick={goCheckout}>Retry price check</button></div>{/if}
    {#if quoteChanged && serverQuote}<label class="notice mt-4 flex items-start gap-3 text-sm"><input type="checkbox" class="mt-1 h-5 w-5" bind:checked={acceptedChangedPrice} disabled={refreshingPreviews || recoveryPending} /><span>I have reviewed the current photos, print choices and total of <strong>{formatCents(serverQuote.totalCents, catalog.currency)}</strong>.</span></label>{/if}
  {/if}
  {#if optionsNeedReload}<div class="notice mt-4 text-sm">The available prints have changed. Refresh first, then choose the current offering; your earlier photo choices stay in your cart for reference.<button type="button" class="button-secondary mt-2" onclick={reloadOptions}>Refresh print options</button></div>{/if}
  {#if refreshingPreviews}<p role="status" class="mt-3 text-sm text-stone-600">Refreshing selected photo previews…</p>{/if}
  {#if recoveryPending}<div class="notice mt-4 text-sm">Some saved previews could not be loaded. Your selected photos have not been changed.<button type="button" class="button-secondary mt-2" onclick={retryPreviews}>Retry saved previews</button></div>{/if}
</div>

{#if loaded}
<div class="fixed inset-x-0 bottom-0 z-40 border-t border-stone-200 bg-white/95 px-4 py-3 backdrop-blur safe-bottom">
  <div class="mx-auto flex max-w-2xl items-center gap-3">
    <div class="mr-auto">
      <div class="text-xs text-stone-500">{itemCount} item{itemCount === 1 ? '' : 's'}</div>
      <div class="text-lg font-semibold">{formatCents(step === 'checkout' && serverQuote ? serverQuote.totalCents : local.totalCents, catalog.currency)}</div>
    </div>
    {#if step === 'choose'}
      {#if cart.items.length}<button type="button" class="rounded-lg bg-stone-900 px-4 py-3 font-medium text-white" onclick={() => (step = 'cart')}>Review order</button>{/if}
    {:else if step === 'fill'}
      <button type="button" class="rounded-lg bg-stone-900 px-4 py-3 font-medium text-white disabled:opacity-40" disabled={!currentFilled} onclick={doneFilling}>{currentFilled ? 'Done' : 'Choose photos'}</button>
    {:else if step === 'cart'}
      <button type="button" class="rounded-lg bg-amber-500 px-4 py-3 font-medium text-stone-900 disabled:opacity-40" disabled={!local.complete || recoveryPending} onclick={goCheckout}>Checkout</button>
    {:else}
      <button type="button" class="rounded-lg border border-stone-300 px-3 py-3 text-sm" disabled={!!cart.pendingOrder} onclick={() => (step = 'cart')}>Back</button>
      {#if demo}<a class="button-primary" href="/o/sample-receipt-1">Sample receipt ↗</a>{:else}
      <button type="submit" form="checkout" class="rounded-lg bg-amber-500 px-4 py-3 font-medium text-stone-900 disabled:opacity-40" disabled={submitting || (!cart.pendingOrder && (quoteLoading || refreshingPreviews || recoveryPending || !serverQuote?.quoteToken || !serverQuote.complete || (quoteChanged && !acceptedChangedPrice)))}>{submitting ? 'Checking…' : cart.pendingOrder ? 'Retry saved order' : 'Place order'}</button>
      {/if}
    {/if}
  </div>
</div>
{/if}

<BottomSheet open={picker.open} title={pickerInspect ? 'Photo preview' : picker.mode === 'cell' ? 'Choose a photo for this print' : picker.mode === 'remaining' ? 'Choose a photo for the empty prints' : 'Choose a favorite moment'} onclose={() => (picker.open = false)} wide={!!pickerInspect} centered={!!pickerInspect}>
  {#if pickerInspect}
    <button type="button" class="button-quiet mb-2" onclick={() => pickerInspect = null}>← All photos</button>
    <PreviewFrame index={inspectIndex} total={pickerPhotos.length} items={pickerPhotos.map(p=>({id:p.id,label:p.displayName,thumb:photoUrl(p,'thumb'),preview:photoUrl(p,'web')}))} onselect={id=>pickerInspect=pickerPhotos.find(p=>p.id===Number(id))??null} onprevious={()=>stepInspect(-1)} onnext={()=>stepInspect(1)}><div class="relative rounded-xl bg-stone-100"><img src={photoUrl(pickerInspect, 'web')} alt="Enlarged print selection" class="max-h-[55dvh] w-full object-contain" /><span class="preview-label">Preview</span></div></PreviewFrame>
    <div class="mt-3 flex flex-wrap gap-2"><button type="button" class="button-secondary" onclick={() => sharePhoto(pickerInspect!, event.slug)}>Share photo ↗</button><a href={photoShareUrl(pickerInspect, event.slug)} target="_blank" rel="noopener" class="button-quiet">Open link</a><button type="button" class="button-primary ml-auto" onclick={() => assign(pickerInspect!.id)}>Use this photo</button></div>
  {:else}
    {#if siblings.length > 1}
      <p class="mb-2 text-xs text-stone-600">Pick a collection by its cover photo. Friends and siblings can be in the same photo.</p>
      <div class="mb-3 flex gap-2 overflow-x-auto pb-2">
        {#each siblings as g, i (g.publicId)}
          <button type="button" class={`w-20 shrink-0 overflow-hidden rounded-xl border-2 text-xs ${pickerTab === g.publicId ? 'border-stone-900 bg-stone-900 text-white' : 'border-stone-200 bg-white'}`} aria-pressed={pickerTab === g.publicId} aria-label={`Collection ${i + 1}, ${g.photoCount} photos`} onclick={() => { pickerTab = g.publicId; void ensureGallery(g.publicId); }}>{#if g.coverUrl}<img src={g.coverUrl} class="h-20 w-full object-cover" alt="" loading="lazy" />{/if}<span class="block py-2">{g.photoCount} photos</span></button>
        {/each}
      </div>
    {/if}
    <label class="mb-3 flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" bind:checked={favoritesOnly} />Show my favorites only</label>
    <p class="mb-3 text-xs text-stone-500">Tap a photo to see the whole moment, then choose it for your print.</p>
    {#if galleryPhotos[pickerTab]}
      <div class="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {#each pickerPhotos as p, i (p.id)}
          <button type="button" class="relative aspect-[4/5] overflow-hidden rounded-xl bg-stone-100" onclick={() => pickerInspect = p} aria-label={`Inspect photo ${i + 1}`}><img src={photoUrl(p, 'preview')} alt="" class="h-full w-full object-contain" loading="lazy" /><span class="preview-label">{favorites.has(p.id) ? '♥ Favorite · preview' : 'Preview'}</span></button>
        {/each}
      </div>
      {#if !pickerPhotos.length}<p class="py-6 text-center text-sm text-stone-500">{favoritesOnly ? 'No favorites in this collection yet. Turn off this filter to see every photo.' : 'Photos are being prepared.'}</p>{/if}
    {:else if galleryErrors[pickerTab]}<div class="notice text-sm">These photos could not be loaded.<button type="button" class="button-secondary mt-2" onclick={() => ensureGallery(pickerTab)}>Try again</button></div>
    {:else}<p role="status" class="py-6 text-center text-sm text-stone-500">Loading the moments…</p>{/if}
  {/if}
</BottomSheet>

{#snippet productCard(p: Product)}
  <li class="rounded-xl border border-stone-200 bg-white p-3">
    <div class="flex items-baseline justify-between gap-2">
      <h3 class="font-semibold">{p.name}</h3>
      <span class="text-lg font-semibold">{formatCents(p.priceCents, catalog.currency)}</span>
    </div>
    <p class="text-sm text-stone-600">{contentsSummary(p, catalog)}</p>
    {#if p.description}<p class="mt-0.5 text-xs text-stone-500">{p.description}</p>{/if}
    <div class="mt-2 flex items-center gap-2">
      {#if p.allowMultiPose && printCount(p, catalog) > 1}<span class="rounded bg-emerald-50 px-2 py-0.5 text-xs text-emerald-800">Mix poses, no extra cost</span>{/if}
      <button type="button" class="ml-auto rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white" onclick={() => addProduct(p)}>Add</button>
    </div>
  </li>
{/snippet}
