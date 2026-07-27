# Shopify Setup — Manuell theme-injektion (5 min)

Följ stegen i ordning. Allt sker i din Shopify Admin — ingen Dev Dashboard, ingen CLI.

> **Uppdaterar du befintligt snippet?** Steg 1 nedan innehåller nu `locale`, `currency`, `rate` och `country` i iframe-URL:en + en `pushContext()`-funktion som skickar `SHOP_CONTEXT` till editorn + en `pushViewport()`-funktion som rapporterar parent-fönstrets synliga del till editorn (så att mobil-drawers ankras till det som faktiskt syns på skärmen och kan scrollas separat utan att stängas). Klistra över den gamla `personlig-karta-editor`-snippeten med blocket nedan.

---

## Steg 1 — Skapa editor-section i temat

> **OBS:** Vi använder en dedikerad section istället för `custom-liquid`, eftersom premiumteman (t.ex. Concept) ofta saknar `sections/custom-liquid.liquid` och då renderas ingenting.

1. **Online Store → Themes** → klicka **⋯** på ditt aktiva tema → **Edit code**
2. **Sections → Add a new section**
3. Namn: `personlig-karta-editor` → **Done**
4. Klistra in följande kod (ersätt allt befintligt innehåll), spara:

```liquid
<style>
  .lovable-map-editor-wrap { width:100%; max-width:100%; margin:0; padding:0; display:block; }
  .lovable-map-editor-wrap iframe { width:100%; min-height:100vh; border:0; display:block; background:#fff; }
</style>

{%- assign editor_handle = product.metafields.custom.template_slug | default: product.handle -%}

<div class="lovable-map-editor-wrap">
  <iframe
    id="lovable-editor-iframe-{{ product.handle }}"
    src="https://artful-create-studio-87.lovable.app/editor?handle={{ editor_handle }}&locale={{ request.locale.iso_code }}&currency={{ localization.country.currency.iso_code | default: cart.currency.iso_code }}&rate={{ cart.currency.rate | default: 1 }}&country={{ localization.country.iso_code }}"
    allow="clipboard-write; geolocation"
    loading="eager"
  ></iframe>
</div>

<script>
(function(){
  var iframe = document.getElementById('lovable-editor-iframe-{{ product.handle }}');
  function pushContext(){
    if(!iframe || !iframe.contentWindow) return;
    iframe.contentWindow.postMessage({
      type:'SHOP_CONTEXT',
      locale: {{ request.locale.iso_code | json }},
      currency: {{ localization.country.currency.iso_code | default: cart.currency.iso_code | json }},
      rate: {{ cart.currency.rate | default: 1 }},
      country: {{ localization.country.iso_code | json }}
    },'*');
  }

  // Rapportera vilken del av iframen som faktiskt syns i kundens fönster,
  // så att overlays (t.ex. mobil-drawern) kan ankras till det synliga
  // området och scrollas separat istället för att hamna utanför skärmen.
  var vpRaf = 0;
  function pushViewport(){
    if(!iframe || !iframe.contentWindow) return;
    var rect = iframe.getBoundingClientRect();
    var vv = window.visualViewport;
    var winTop = vv ? vv.offsetTop : 0;
    var winH = vv ? vv.height : window.innerHeight;
    var visTopInWin = Math.max(winTop, rect.top);
    var visBottomInWin = Math.min(winTop + winH, rect.bottom);
    var visibleHeight = Math.max(0, visBottomInWin - visTopInWin);
    var iframeVisibleTop = Math.max(0, visTopInWin - rect.top);
    iframe.contentWindow.postMessage({
      type:'SHOP_VIEWPORT',
      iframeVisibleTop: iframeVisibleTop,
      visibleHeight: visibleHeight
    },'*');
  }
  function schedulePushViewport(){
    if(vpRaf) return;
    vpRaf = window.requestAnimationFrame(function(){ vpRaf = 0; pushViewport(); });
  }

  iframe && iframe.addEventListener('load', function(){ pushContext(); pushViewport(); });
  document.addEventListener('visibilitychange', function(){
    if(document.visibilityState==='visible'){ pushContext(); pushViewport(); }
  });
  window.addEventListener('scroll', schedulePushViewport, { passive: true });
  window.addEventListener('resize', schedulePushViewport);
  if(window.visualViewport){
    window.visualViewport.addEventListener('resize', schedulePushViewport);
    window.visualViewport.addEventListener('scroll', schedulePushViewport);
  }

  window.addEventListener('message', function(e){
    var d = e.data; if(!d || typeof d!=='object') return;
    if(d.type==='EDITOR_RESIZE' && typeof d.height==='number' && iframe){
      iframe.style.height = Math.max(600,d.height)+'px';
      schedulePushViewport();
      return;
    }
    if(d.type!=='ADD_TO_CART') return;
    // Drink-väljaren kan välja en ANNAN drinks huvudprodukt än den sida kunden
    // står på; lägg då till den VALDA produkten (d.handle). Faller tillbaka
    // till sidans produkt när ingen handle skickas.
    var addHandle = d.handle || '{{ product.handle }}';
    fetch('/products/'+addHandle+'.js').then(function(r){return r.json();})
      .then(function(p){
        var match = p.variants.find(function(v){
          var o=(v.options||[]).map(function(x){return String(x).toLowerCase();});
          return o.indexOf(String(d.size).toLowerCase())>-1 && o.indexOf(String(d.variant).toLowerCase())>-1;
        }) || p.variants[0];
        var props={};
        Object.keys(d.properties||{}).forEach(function(k){props[k]=d.properties[k];});
        return fetch('/cart/add.js',{
          method:'POST',
          headers:{'Content-Type':'application/json'},
          body: JSON.stringify({id:match.id, quantity:d.quantity||1, properties:props})
        });
      })
      .then(function(r){return r.json();})
      .then(function(){ window.location.href='/cart'; })
      .catch(function(err){ console.error('add to cart failed', err); });
  });
})();
</script>

{% schema %}
{
  "name": "Personlig Karta Editor",
  "settings": [],
  "presets": [{ "name": "Personlig Karta Editor" }]
}
{% endschema %}
```

`{% schema %}`-blocket är obligatoriskt — utan det renderar Shopify ingenting.

---

## Steg 2 — Skapa product-template

1. **Templates → Add a new template**
2. Välj **For**: `product`, **Type**: `JSON`, **Name**: `personlig-karta`
3. Ersätt innehållet med:

```json
{
  "sections": {
    "editor": {
      "type": "personlig-karta-editor"
    }
  },
  "order": ["editor"]
}
```
---

## Steg 3 — Tilldela template till produkterna

För **varje** produkt (`personlig-karta-poster` och `personlig-karta-canvas`):

1. **Products** → öppna produkten
2. Höger sidofält → **Theme template** → välj `personlig-karta`
3. **Save**

---

## Steg 4 — Registrera order-webhook

1. **Settings** (kugghjul nere till vänster) → **Notifications**
2. Scrolla ner till **Webhooks** → **Create webhook**
3. Fyll i:
   - **Event**: `Order payment`
   - **Format**: `JSON`
   - **URL**: `https://ptzmnusfgdwcqpjpbyco.supabase.co/functions/v1/shopify-order-webhook`
   - **Webhook API version**: senaste (2025-07 eller nyare)
4. Klicka **Save**
5. **VIKTIGT**: Efter Save visas en **"Webhook signing secret"** högst upp på Webhooks-sidan (en sträng som börjar med bokstäver/siffror). **Kopiera den.**
6. Skicka till mig i chatten: `webhook secret klart` — då öppnar jag säker dialog för dig att klistra in den.

---

## Steg 5 — Test

1. Öppna `https://wdxugd-yq.myshopify.com/products/personlig-karta-poster` → editorn ska rendera utan Shopify-prischrome runt om
2. Skapa en design → "Lägg i varukorg" → checka ut via **Bogus Gateway** (Settings → Payments → test mode)
3. Säg "test order skickad" — jag kollar `gelato_orders`-tabellen och bekräftar att Gelato fick ordern

---

## Steg 6 — Cart-thumbnail visar designens preview (KRÄVS)

Shopifys `/cart/add.js` kan inte sätta line-item bild, så cart visar produktbilden som default. Vi läser istället `_preview_image`-property som editorn skickar med.

1. **Online Store → Themes → ⋯ → Edit code**
2. Hitta filen som renderar cart-rader. Vanliga namn:
   - `sections/main-cart-items.liquid`
   - `snippets/cart-item.liquid`
   - `sections/cart-template.liquid`
   - (Dawn / Sense): `sections/main-cart-items.liquid`
3. Hitta raden där `item.image` eller `line_item.image` används i en `<img>`-tag, t.ex.:
   ```liquid
   <img src="{{ item.image | image_url: width: 300 }}" ...>
   ```
4. Ersätt `item.image | image_url: width: 300` med:
   ```liquid
   {%- if item.properties._preview_image != blank -%}
     {{ item.properties._preview_image }}
   {%- else -%}
     {{ item.image | image_url: width: 300 }}
   {%- endif -%}
   ```
   Spara.
5. (Valfritt) Dölj de interna `_`-prefixerade properties från cart-listan så kunden inte ser tekniska URLs. Hitta loopen som listar properties:
   ```liquid
   {% for p in item.properties %}
     {%- assign first_char = p.first | slice: 0 -%}
     {%- unless first_char == '_' -%}
       <p>{{ p.first }}: {{ p.last }}</p>
     {%- endunless -%}
   {% endfor %}
   ```

---

## Steg 7 — Orderbekräftelse-mejlet visar designens preview (KRÄVS)

Shopifys standard `Order confirmation`-mejl visar produktbilden från Shopify, inte den personliga design kunden faktiskt beställde. Editorn skickar redan med `_preview_image`-property (samma URL som cart-thumbnailen) — vi behöver bara säga åt mejl-templaten att läsa den.

> `_`-prefixet gör att property:n redan automatiskt döljs i kundens egen property-lista (default-templaten har `property_first_char != '_'`), så vi behöver bara byta `<img>`-rader.

### 7.1 Öppna mejl-templaten
1. **Settings** (kugghjul) → **Notifications** → **Customer notifications** → **Order confirmation** → **Edit code**
2. Klicka i kodrutan och tryck **Cmd/Ctrl + F** för Find & Replace.

### 7.2 Patch — samma mönster på flera ställen
Standardtemplaten har 4 olika bild-rendering-patterns (`line`, `child_line`, `component`, `parent_line_item`). De förekommer både i legacy-spåret (`subtotal_line_items`) och i nya delivery-agreements-spåret. **Använd Find All** i Shopifys editor — varje block ska bytas på alla träffar.

#### Block 1 — `line` (huvudprodukten)
**Hitta:**
```liquid
<img src="{{ line | img_url: 'compact_cropped' }}" align="left" width="60" height="60" class="order-list__product-image"/>
```
**Ersätt med:**
```liquid
{%- assign _preview = line.properties._preview_image -%}
{% if _preview != blank %}
  <img src="{{ _preview }}" align="left" width="60" height="60" class="order-list__product-image"/>
{% else %}
  <img src="{{ line | img_url: 'compact_cropped' }}" align="left" width="60" height="60" class="order-list__product-image"/>
{% endif %}
```

#### Block 2 — `child_line` (under-rader, t.ex. bundles)
**Hitta:**
```liquid
<img src="{{ child_line | img_url: 'compact_cropped' }}" align="left" width="40" height="40" class="order-list__product-image small"/>
```
**Ersätt med:**
```liquid
{%- assign _preview = child_line.properties._preview_image -%}
{% if _preview != blank %}
  <img src="{{ _preview }}" align="left" width="40" height="40" class="order-list__product-image small"/>
{% else %}
  <img src="{{ child_line | img_url: 'compact_cropped' }}" align="left" width="40" height="40" class="order-list__product-image small"/>
{% endif %}
```

#### Block 3 — `parent_line_item` (gruppvy)
**Hitta:**
```liquid
<img src="{{ parent_line_item | img_url: 'compact_cropped' }}" align="left" width="60" height="60" class="order-list__product-image"/>
```
**Ersätt med:**
```liquid
{%- assign _preview = parent_line_item.properties._preview_image -%}
{% if _preview != blank %}
  <img src="{{ _preview }}" align="left" width="60" height="60" class="order-list__product-image"/>
{% else %}
  <img src="{{ parent_line_item | img_url: 'compact_cropped' }}" align="left" width="60" height="60" class="order-list__product-image"/>
{% endif %}
```

#### Block 4 — `component` (komponenter i bundles)
**Hitta:**
```liquid
<img src="{{ component | img_url: 'compact_cropped' }}" align="left" width="40" height="40" class="order-list__product-image"/>
```
**Ersätt med:**
```liquid
{%- assign _preview = component.properties._preview_image -%}
{% if _preview != blank %}
  <img src="{{ _preview }}" align="left" width="40" height="40" class="order-list__product-image"/>
{% else %}
  <img src="{{ component | img_url: 'compact_cropped' }}" align="left" width="40" height="40" class="order-list__product-image"/>
{% endif %}
```

### 7.3 Spara & testa
1. Klicka **Save** uppe till höger.
2. Shopifys **Preview**-knapp använder dummy-data utan properties → previewbilden där visar fortfarande default. Det är förväntat.
3. Gör en riktig testorder via **Bogus Gateway** med en personlig design.
4. Kolla det riktiga mejlet → tavla-previewen ska nu visas istället för standardproduktbilden.

### 7.4 Fallback-beteende
- Saknas `_preview_image` (gammal order, vanlig produkt utan editor) → faller automatiskt tillbaka på Shopifys produktbild. Inget kan gå sönder.
- Vill du senare göra samma sak för **Shipping confirmation** / **Refund**-mejl, kopiera samma 4 block till respektive template.

---

## Felsökning

- **Editor visas inte / ser ut som vanlig produktsida** → template inte tilldelad. Gå tillbaka till Steg 3.
- **Editor laddar men "Lägg i varukorg" gör inget** → öppna browser DevTools → Console → leta efter fel. Skicka skärmdump.
- **Order betalas men Gelato får inget** → öppna edge function-loggar för `shopify-order-webhook`. Om du ser `missing_print_file_url` betyder det att klienten inte hann skicka med tryckfilen — be kunden göra om designen och testa igen. Om problemet kvarstår systematiskt: skicka logg-utdraget i chatten.
- **Cart-thumbnail visar fortfarande produktbilden** → Steg 6 är inte klart, eller fel template-fil. Sök i temat efter `item.image` och tillämpa snippet på alla cart-rendering-platser.
- **Orderbekräftelse-mejlet visar fortfarande default-produktbild** → Steg 7 ej klart eller fel template-spår. Sök i Order confirmation-templaten efter alla `| img_url:` och tillämpa motsvarande block (1–4) på alla träffar. Verifiera att kunden faktiskt fick `_preview_image` på line item:t — kolla ordern i Admin → varje line item ska visa `_preview_image: https://…cart-previews/…jpg` i Properties.
```