/**
 * Descripcion, destacados y ficha tecnica de un producto de Quimica Suiza a
 * partir de lo que ya sabemos de el: su nombre comercial (que en farmacia ES la
 * ficha: marca, dosis, forma y unidades), su principio activo y su categoria.
 *
 * Nada se inventa que no se pueda leer del nombre o del diccionario: ni
 * registro sanitario, ni dosis de uso, ni contraindicaciones. Lo que no se
 * sabe, no se escribe.
 */
import { VENTA, farmacoDe, norm } from './farmacos.mjs'

// ---------------------------------------------------------------------------
// Lectura del nombre
// ---------------------------------------------------------------------------

/** [patron sobre el nombre normalizado, singular, plural, via] — el primero que casa gana. */
const FORMAS = [
  [/parches? transdermic/, 'Parche transdérmico', 'parches', 'Transdérmica'],
  [/\bparche/, 'Parche', 'parches', 'Tópica'],
  // Nombres del ERP que no dicen la forma: se sabe por el producto.
  [/\bclinfol duo\b/, 'Óvulo vaginal', 'óvulos vaginales', 'Vaginal'],
  [/\bmd\d+cmp\b/, 'Tableta bucodispersable', 'tabletas bucodispersables', 'Oral'],
  [/^(iltux|iltuxam|brunelle|irrigor plus|colmibe)\b(?!.*(capsul|cap\b))/, 'Tableta recubierta', 'tabletas recubiertas', 'Oral'],
  [/capsulas? blandas? vaginal/, 'Cápsula blanda vaginal', 'cápsulas vaginales', 'Vaginal'],
  [/\bovu(los?)?\b/, 'Óvulo vaginal', 'óvulos vaginales', 'Vaginal'],
  [/crema vaginal|rema vaginal/, 'Crema vaginal', 'tubo', 'Vaginal'],
  [/jeringa precargada|\bjer\b/, 'Solución inyectable (jeringa prellenada)', 'jeringas prellenadas', 'Inyectable'],
  [/inyectable|\bsol iny|\bampolla|\bamp\b/, 'Solución inyectable', 'ampollas', 'Inyectable'],
  [/otica/, 'Solución ótica', 'frasco gotero', 'Ótica'],
  [/\bgotas\b/, 'Gotas orales', 'frasco gotero', 'Oral'],
  [/jarabe/, 'Jarabe', 'frasco', 'Oral'],
  [/granul|polvo para suspension/, 'Polvo para suspensión oral', 'frasco', 'Oral'],
  [/suspension/, 'Suspensión oral', 'frasco', 'Oral'],
  [/polvo para solucion|solucion caja .* sobres|\bsobres\b/, 'Polvo para solución oral', 'sobres', 'Oral'],
  [/solucion oral/, 'Solución oral', 'frasco', 'Oral'],
  [/\bunguento/, 'Ungüento', 'tubo', 'Tópica'],
  [/\bpda rectal|pomada rectal/, 'Pomada rectal', 'tubo', 'Rectal'],
  [/masticable/, 'Tableta masticable', 'tabletas masticables', 'Oral'],
  [/bebida|rehidratante/, 'Solución oral', 'frasco', 'Oral'],
  [/crema dermica/, 'Crema', 'tubo', 'Tópica'],
  [/liberacion prol|\blp\b|\bretard\b|\bxr\b|\blr\b/, null, null, 'Oral'],
  [/capsula blanda/, 'Cápsula blanda', 'cápsulas blandas', 'Oral'],
  [/\bcap(sula|sulas|s)?\b/, 'Cápsula', 'cápsulas', 'Oral'],
  [/\bgageas|\bgrageas/, 'Gragea', 'grageas', 'Oral'],
  [/recubiert|\bcomp rec\b|\btab rec\b|\bcop rec\b/, 'Tableta recubierta', 'tabletas recubiertas', 'Oral'],
  [/\btableta|\btabletas|\bcomprimid|\bc0mprimid|\bcomp\b|\bcmp\b|\bcop\b|\bcom\b|\btab\b|\bcomprimdo/, 'Tableta', 'tabletas', 'Oral'],
]

function formaDe(n) {
  let prolongada = false
  for (const [re, sing, plural, via] of FORMAS) {
    if (!re.test(n)) continue
    if (sing === null) {
      prolongada = true
      continue
    }
    if (prolongada && /tableta|capsula/i.test(norm(sing))) {
      const esCapsula = /capsula/.test(norm(sing))
      return {
        forma: `${sing} de liberación prolongada`,
        plural: esCapsula ? 'cápsulas de liberación prolongada' : 'tabletas de liberación prolongada',
        via,
      }
    }
    return { forma: sing, plural, via }
  }
  if (prolongada) return { forma: 'Tableta de liberación prolongada', plural: 'tabletas de liberación prolongada', via: 'Oral' }
  return null
}

const num = (s) => s.replace(',', '.')

/** La concentracion tal como la escribe el envase: «500 mg», «37.5 mg / 325 mg», «35 µg/h». */
function dosisDe(nombre) {
  let t = nombre
  for (let previo = ''; previo !== t; ) {
    previo = t
    t = t.replace(/(\d\s*(?:mg)?)\s*-\s*(\d)/i, '$1/$2').replace(/(\d) (\d{3})\b/, '$1$2')
  }
  const porMl = t.match(/(\d+(?:[.,]\d+)?)\s*mg\s*\/\s*(\d+(?:[.,]\d+)?)?\s*ml\b/i)
  if (porMl && !/\d\s*(mg|mcg|g)?\s*[+/]\s*\d+(?:[.,]\d+)?\s*mg\s*\//i.test(t)) {
    return `${num(porMl[1])} mg/${porMl[2] ? `${num(porMl[2])} ` : ''}ml`
  }
  const m =
    t.match(/(\d+(?:[.,]\d+)?)\s*(ug|µg)\s*\/\s*h/i) ??
    t.match(/(\d+(?:[.,]\d+)?\s*(?:mg|mcg|g|gr)?\s*(?:\/|\+)\s*)+\d+(?:[.,]\d+)?\s*(mg|mcg|g|gr|ml)\b(?:\s*\/\s*\d*\s*ml)?/i) ??
    t.match(/(\d+(?:[.,]\d+)?)\s*(mg|mcg|ui|%)(?![a-z])/i) ??
    t.match(/\b(\d+(?:[.,]\d+)?)\s*(g|gr)\b(?=\s*(tableta|comprimid|solucion|capsul))/i)
  if (!m) return null
  let d = m[0].trim()
  if (/ug|µg/i.test(m[2] ?? '') && /\/\s*h/i.test(d)) return `${num(m[1])} µg/h`
  d = d
    .replace(/\s*\/\s*/g, ' / ')
    .replace(/\s*\+\s*/g, ' + ')
    .replace(/(\d)\s*(mg|mcg|ml|g|gr|ui)\b/gi, '$1 $2')
    .replace(/\bgr\b/gi, 'g')
    .replace(/\bmcg\b/gi, 'mcg')
    .replace(/\bMg\b/g, 'mg')
    .replace(/\bMl\b/g, 'ml')
    .replace(/\bUi\b/g, 'UI')
    .replace(/,/g, '.')
  return d
}

/** Unidades del envase (comprimidos, capsulas, sobres...). */
function unidadesDe(nombre) {
  const n = norm(nombre)
  const m =
    n.match(/\b(?:caja|cja|cj|cjax|x)\s*(\d{1,3})\s*(?:un|und|unid|comp|cap|tab|sobres?|capsulas?|comprimidos?)?\b/) ??
    n.match(/\b(\d{1,3})\s*(?:un|und|unid|u|comp|comprimidos?|capsulas?|cap|tab|tabletas?|cmp|sobres|gageas|grageas|capsulas blandas)\b/) ??
    n.match(/md(\d{1,3})cmp/)
  if (!m) return null
  const u = Number(m[1])
  return u > 0 && u < 1000 ? u : null
}

/** Contenido neto de un envase (volumen o peso), si lo dice el nombre. */
function contenidoDe(nombre) {
  const t = nombre.replace(/ x /gi, ' ')
  const all = [...t.matchAll(/(\d+(?:[.,]\d+)?)\s*(ml|l|lt|litro|gr|g|kg|oz)\b(?!\s*\/)/gi)]
  // Una concentracion «100 mg/5 ml» no es el contenido: se descarta lo que va tras una barra.
  const limpios = all.filter((m) => !/\/\s*$/.test(t.slice(0, m.index)))
  const m = limpios.at(-1)
  if (!m) return null
  const v = num(m[1])
  const u = m[2].toLowerCase()
  const unidad = { ml: 'ml', l: 'L', lt: 'L', litro: 'L', gr: 'g', g: 'g', kg: 'kg', oz: 'oz' }[u]
  return `${v} ${unidad}`
}

/** «Consiv», «Quetiazic XR», «Paxelis Retard»: el nombre comercial sin dosis ni envase. */
function marcaComercial(nombre) {
  const corte = nombre.search(
    /\s(\d|Tableta|Comprimid|C0mprimid|Capsula|Cápsula|Solucion|Solución|Gotas|Jarabe|Suspension|Polvo|Granul|Ovulo|Óvulo|Ovu|Parche|Ungüento|Unguento|Ampolla|Comp|Cap\b|Pda|Crema|Emulsion|Emulsión|Caja|Cja|Sol\b)/i,
  )
  const base = (corte > 0 ? nombre.slice(0, corte) : nombre).trim()
  return base.replace(/\bXr\b/, 'XR').replace(/\bHct\b/, 'HCT').replace(/\bNf\b/, 'NF')
}

const capital = (s) =>
  String(s)
    .toLowerCase()
    .replace(/(^|[\s+/(-])([a-záéíóúñ])/g, (_, a, b) => a + b.toUpperCase())
    .replace(/\b(De|Del|Y|E|Con|La|El)\b/g, (w) => w.toLowerCase())
    .replace(/\bIii\b/, 'III')
    .replace(/\bVit\b\.?/g, 'Vit.')

function principioLegible(pa) {
  if (!pa) return null
  return capital(
    pa
      .replace(/\s*\+\s*/g, ' + ')
      .replace(/\s*\/\s*/g, ' + ')
      .replace(/\s+\d+\s*MG\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

// ---------------------------------------------------------------------------
// Medicamentos
// ---------------------------------------------------------------------------

function presentacionMed(f, unidades, contenido) {
  if (!f) return contenido ? `Envase de ${contenido}` : null
  if (['frasco', 'frasco gotero', 'tubo'].includes(f.plural)) {
    return contenido ? `${f.plural === 'tubo' ? 'Tubo' : f.plural === 'frasco' ? 'Frasco' : 'Frasco gotero'} de ${contenido}` : null
  }
  if (!unidades) return null
  if (unidades === 1) {
    const sing = norm(f.forma).startsWith('solucion inyectable (') ? 'jeringa prellenada' : f.plural === 'ampollas' ? 'ampolla' : f.forma.toLowerCase()
    return `Caja con 1 ${sing}`
  }
  return `Caja x ${unidades} ${f.plural}`
}

function fichaMedicamento(p) {
  const n = norm(p.name)
  const pa = p.cf?.principio_activo ?? null
  const farm = farmacoDe(pa)
  if (!farm) return null
  const f = formaDe(n)
  const dosis = dosisDe(p.name)
  const unidades = unidadesDe(p.name)
  const contenido = contenidoDe(p.name)
  const presentacion = presentacionMed(f, unidades, contenido)
  const principio = principioLegible(pa)
  const marca = marcaComercial(p.name)
  const venta = VENTA[farm.venta]

  const partes = []
  partes.push(
    `${marca}${dosis ? ` ${dosis}` : ''} contiene ${principio.toLowerCase().includes('+') ? 'la combinación de ' : ''}${principio}, ${minus(farm.grupo)}${p.brand ? ` del laboratorio ${p.brand}` : ''}.`,
  )
  partes.push(`Indicado para: ${minus(farm.uso)}.`)
  const como = [presentacion ? `Se presenta en ${minus(presentacion)}` : null, f ? `para administración ${viaFrase(f.via)}` : null]
    .filter(Boolean)
    .join(' ')
  if (como) partes.push(`${como}.`)
  partes.push(venta.frase)
  partes.push('Lee el prospecto y sigue las indicaciones de tu médico o químico farmacéutico.')

  const highlights = [
    `Principio activo: ${principio}`.slice(0, 120),
    f || dosis ? [f?.forma, dosis].filter(Boolean).join(' de ').slice(0, 120) : null,
    presentacion,
    farm.venta === 'L' ? 'Venta libre' : farm.venta === 'C' ? 'Receta médica especial retenida' : 'Requiere receta médica',
    p.brand ? `Laboratorio ${p.brand}` : null,
  ].filter(Boolean)

  // Con descripcion propia del ERP (suele traer la indicacion), esa va primero
  // y se completa con lo que no dice: composicion, envase y condicion de venta.
  const propia = p.description?.trim() && p.description.trim().length >= 25 ? p.description.trim().replace(/\.?$/, '.') : null
  const descripcion = propia ? [propia, partes[0], ...partes.slice(2)].join(' ') : partes.join(' ')
  return {
    tipo: 'medicamento',
    descripcion,
    complemento: [como ? `${como}.` : null, venta.frase, 'Lee el prospecto y sigue las indicaciones de tu médico o químico farmacéutico.']
      .filter(Boolean)
      .join(' '),
    highlights,
    ficha: {
      principio_activo: principio,
      dosis: dosis ?? undefined,
      forma_farmaceutica: f ? f.forma : undefined,
      via_administracion: f ? f.via : undefined,
      grupo_terapeutico: farm.grupo,
      condicion_venta: venta.ficha,
      contenido_neto: presentacion ?? undefined,
      receta: farm.venta !== 'L',
    },
    variante: { dosis, presentacion, unidades, f },
  }
}

const minus = (s) => (s ? s.charAt(0).toLowerCase() + s.slice(1) : s)
const viaFrase = (via) =>
  ({ Oral: 'oral', Tópica: 'tópica', Vaginal: 'vaginal', Ótica: 'ótica', Rectal: 'rectal', Transdérmica: 'transdérmica', Inyectable: 'inyectable' })[via] ?? minus(via)

// ---------------------------------------------------------------------------
// Dermocosmetica, cuidado personal y cabello
// ---------------------------------------------------------------------------

/**
 * Reglas por palabra clave del nombre: [patron, tipo, beneficio, modo de uso, indicado para].
 * La primera que casa gana; las lineas concretas van antes que las genericas.
 */
const COSMETICA = [
  // Sebastian Professional
  [/cellophanes/, 'Brillo con color semipermanente', 'Tratamiento de brillo con color que realza y aviva el tono del cabello sin amoníaco, con efecto espejo y acondicionador', 'Aplicar sobre el cabello limpio y húmedo, dejar actuar según el resultado buscado y enjuagar.', 'Cabello natural o teñido que busca brillo y matiz'],
  [/twisted/, null, 'Línea para rizos: define, controla el frizz y da elasticidad a los rizos y ondas', null, 'Cabello rizado u ondulado'],
  [/dark oil/, null, 'Línea con aceites ligeros que nutre, suaviza y aporta brillo sin apelmazar', null, 'Todo tipo de cabello'],
  [/penetraitt/, null, 'Línea reparadora que fortalece el cabello dañado por químicos, calor o tratamientos', null, 'Cabello dañado o químicamente tratado'],
  [/hydre/, null, 'Línea hidratante que devuelve suavidad y movimiento al cabello seco', null, 'Cabello seco'],
  [/trilliance/, null, 'Línea de brillo que realza la luminosidad del cabello', null, 'Cabello opaco que busca brillo'],
  [/potion 9 lite/, 'Tratamiento sin enjuague', 'Tratamiento ligero sin enjuague que restaura, suaviza y protege el cabello fino', 'Aplicar sobre el cabello húmedo, de medios a puntas, sin enjuagar.', 'Cabello fino'],
  [/potion 9/, 'Tratamiento sin enjuague', 'Tratamiento restaurador sin enjuague con extractos botánicos que suaviza, desenreda y da manejabilidad', 'Aplicar sobre el cabello húmedo, de medios a puntas, sin enjuagar.', 'Cabello seco o dañado'],
  [/no breaker/, 'Spray reparador sin enjuague', 'Spray que fortalece la fibra capilar y reduce el quiebre desde la primera aplicación', 'Aplicar sobre el cabello húmedo antes de peinar.', 'Cabello frágil o con quiebre'],
  [/shaper fierce/, 'Laca de fijación extrafuerte', 'Laca de fijación extrafuerte y secado rápido que se elimina fácil al cepillar', 'Aplicar a 30 cm del cabello ya peinado.', 'Peinados que necesitan fijación máxima'],
  [/zero gravity/, 'Laca de fijación ligera', 'Spray de fijación seca y sin peso que da control sin rigidez', 'Aplicar a 30 cm del cabello ya peinado.', 'Cabello fino o peinados con movimiento'],
  [/re-shaper|re shaper/, 'Laca de fijación fuerte', 'Laca de fijación fuerte y flexible que permite remodelar el peinado', 'Aplicar a 30 cm del cabello ya peinado.', 'Peinados que se retocan durante el día'],
  [/whipped creme/, 'Crema de peinado', 'Crema ligera que define y da cuerpo sin dejar residuos', 'Aplicar sobre el cabello húmedo y peinar.', 'Todo tipo de cabello'],
  [/liquid steel/, 'Gel de fijación extrema', 'Gel de fijación extrema que da forma y textura duraderas', 'Aplicar sobre el cabello húmedo o seco y modelar.', 'Peinados estructurados'],
  [/gel sebastian forte|forte/, 'Gel de fijación fuerte', 'Gel de fijación fuerte con acabado brillante', 'Aplicar sobre el cabello húmedo y modelar.', 'Peinados con forma definida'],
  [/thickefy/, 'Espuma voluminizadora', 'Espuma que da cuerpo y volumen desde la raíz', 'Aplicar sobre el cabello húmedo, en la raíz, antes del secado.', 'Cabello fino o sin volumen'],
  [/taming elixir/, 'Sérum antifrizz', 'Sérum ligero que controla el frizz y sella las puntas', 'Aplicar unas gotas de medios a puntas sobre cabello húmedo o seco.', 'Cabello con frizz'],
  [/matte putty/, 'Cera mate', 'Cera de acabado mate y fijación flexible para texturizar', 'Calentar una pequeña cantidad entre las manos y aplicar sobre el cabello seco.', 'Cabello corto o medio'],
  [/craft clay/, 'Arcilla moldeadora', 'Arcilla de fijación media y acabado natural, remodelable', 'Calentar entre las manos y aplicar sobre el cabello seco.', 'Cabello corto o medio'],
  [/texturizer/, 'Gel texturizante', 'Gel que da cuerpo y textura con fijación flexible', 'Aplicar sobre el cabello húmedo y secar.', 'Cabello fino'],
  [/microweb/, 'Fibra elástica de peinado', 'Fibra moldeadora con fijación flexible y textura', 'Aplicar sobre el cabello seco y modelar.', 'Cabello corto o medio'],
  [/trilliant/, 'Protector térmico', 'Spray que protege del calor de la secadora y la plancha y aporta brillo', 'Aplicar sobre el cabello antes de usar herramientas de calor.', 'Cabello que se plancha o seca a diario'],
  [/shine define/, 'Spray de brillo', 'Spray de brillo intenso con fijación ligera', 'Aplicar sobre el peinado terminado.', 'Todo tipo de cabello'],
  [/shine crafter/, 'Cera de brillo', 'Cera de fijación media y acabado brillante', 'Calentar entre las manos y aplicar sobre el cabello seco.', 'Cabello corto o medio'],
  [/sebman.*aceite|aceite para barba/, 'Aceite para barba y cabello', 'Aceite ligero que suaviza la barba, nutre la piel y da brillo', 'Aplicar unas gotas sobre la barba limpia y peinar.', 'Hombres con barba'],
  [/sebman.*pomada|pomada sebman/, 'Pomada modeladora', 'Pomada de acabado brillante y fijación media', 'Aplicar sobre el cabello seco y peinar.', 'Cabello corto masculino'],
  [/sebman.*multitasker/, 'Shampoo 3 en 1', 'Limpia cabello, barba y cuerpo en un solo paso', 'Aplicar, masajear y enjuagar.', 'Hombres'],
  [/sebman/, null, 'Línea masculina de Sebastian para el cuidado diario de cabello y barba', null, 'Hombres'],
  [/welloxon/, 'Oxidante en crema', 'Emulsión oxidante para mezclar con el color o el decolorante profesional', 'Mezclar en la proporción que indique el color; uso profesional.', 'Uso profesional en salón'],
  // Eucerin
  [/hyaluron|hyal fill|hy f/, null, 'Línea antiedad con ácido hialurónico que rellena arrugas y devuelve firmeza', null, 'Piel madura con arrugas'],
  [/anti pigment|pigment control|pigmentos|anti pigmentacion/, null, 'Línea con Thiamidol que reduce las manchas oscuras y previene su reaparición', null, 'Piel con manchas o hiperpigmentación'],
  [/dermopur|dermopure|oil control/, null, 'Línea para piel grasa con tendencia acneica: limpia, matifica y reduce imperfecciones', null, 'Piel grasa o con acné'],
  [/aquaphor/, 'Pomada reparadora', 'Pomada que repara la piel muy seca, agrietada o irritada', 'Aplicar sobre la zona afectada las veces que sea necesario.', 'Piel muy seca, agrietada o irritada'],
  [/urea/, 'Crema reparadora con urea', 'Crema con urea que hidrata intensamente y suaviza la piel muy seca y áspera', 'Aplicar sobre la piel limpia una o dos veces al día.', 'Piel muy seca y áspera'],
  [/atopi/, 'Bálsamo para piel atópica', 'Bálsamo que calma el picor y restaura la barrera de la piel atópica', 'Aplicar sobre la piel limpia una o dos veces al día.', 'Piel atópica'],
  [/baby/, null, 'Cuidado suave para la piel delicada del bebé, sin perfume', null, 'Bebés y piel sensible'],
  [/dermo ?capilar|dermocapilar/, null, 'Línea dermocapilar para el cuero cabelludo sensible', null, null],
  [/ph5|syndet/, null, 'Línea pH5 que protege la piel sensible y respeta su pH natural', null, 'Piel sensible'],
  [/anti estrias/, 'Aceite antiestrías', 'Aceite que mejora la elasticidad de la piel y ayuda a prevenir las estrías', 'Aplicar con masaje sobre abdomen, caderas y pecho.', 'Embarazo y cambios de peso'],
  [/derm pur|aceite corporal/, 'Aceite corporal', 'Aceite que hidrata y suaviza la piel', 'Aplicar con masaje sobre la piel.', 'Piel seca'],
  [/aceite de ducha|dermo ac/, 'Aceite de ducha', 'Aceite limpiador que no reseca la piel muy seca', 'Usar en la ducha en lugar del jabón.', 'Piel muy seca'],
  // Solares
  [/kids/, 'Protector solar infantil', 'Protección solar muy alta para la piel sensible de los niños, resistente al agua', 'Aplicar generosamente antes de la exposición al sol y reaplicar cada 2 horas.', 'Niños'],
  [/fps|spf|sun|bloqueador|solar/, 'Protector solar', 'Protección solar alta frente a los rayos UVA y UVB', 'Aplicar generosamente 15 minutos antes de la exposición al sol y reaplicar cada 2 horas.', null],
  // Nivea y cuidado general
  [/rose care/, null, 'Línea con agua de rosas orgánica que hidrata y refresca', null, 'Todo tipo de piel'],
  [/micelar|micell|\bmice\b/, 'Agua micelar', 'Limpia, desmaquilla y tonifica en un solo paso, sin enjuague', 'Aplicar con un algodón sobre rostro, ojos y labios.', 'Todo tipo de piel'],
  [/q10/, null, 'Con coenzima Q10, que ayuda a reafirmar la piel', null, null],
  [/antiarrugas/, 'Crema facial antiarrugas', 'Crema que hidrata y reduce la apariencia de las arrugas', 'Aplicar por la mañana y por la noche sobre rostro y cuello limpios.', 'Piel madura'],
  [/aclara|clarity|extraclaro|extra aclarado/, null, 'Fórmula que ayuda a aclarar y unificar el tono de la piel', null, null],
  [/lip balm|protector labial|labial/, 'Bálsamo labial', 'Hidrata y protege los labios del resecamiento', 'Aplicar sobre los labios las veces que sea necesario.', 'Labios secos'],
  [/after shave|balsamo .*shave/, 'Bálsamo after shave', 'Calma la irritación y refresca la piel después del afeitado', 'Aplicar sobre la piel limpia después de afeitar.', 'Hombres'],
  [/espuma de afeitar|gel nivea for men/, 'Espuma de afeitar', 'Facilita un afeitado suave y protege la piel de la irritación', 'Aplicar sobre la barba húmeda, afeitar y enjuagar.', 'Hombres'],
  [/talco|pies/, 'Cuidado de los pies', 'Controla el olor y la humedad de los pies y el calzado', 'Aplicar sobre los pies limpios y secos y dentro del calzado.', 'Pies con sudoración'],
  [/intimo/, 'Jabón íntimo', 'Limpieza suave de la zona íntima que respeta su pH natural', 'Usar diariamente en la ducha.', 'Mujeres'],
  [/curitas|vendita/, 'Curitas adhesivas', 'Protegen pequeñas heridas y cortes de la suciedad y el roce', 'Limpiar y secar la piel antes de aplicar.', 'Botiquín del hogar'],
  [/d.?hipoglos|hipoglos/, 'Emulsión protectora para el pañal', 'Forma una barrera que protege la piel del bebé de la humedad y ayuda a prevenir y aliviar la dermatitis del pañal', 'Aplicar en cada cambio de pañal sobre la piel limpia y seca.', 'Bebés'],
  [/scrub|exfoliante/, 'Exfoliante', 'Elimina las células muertas y deja la piel suave y renovada', 'Aplicar sobre la piel húmeda con masaje circular y enjuagar.', 'Todo tipo de piel'],
  [/tonico/, 'Tónico facial', 'Completa la limpieza y refresca la piel', 'Aplicar con un algodón sobre el rostro limpio.', null],
  [/leche limpiadora/, 'Leche limpiadora', 'Limpia y desmaquilla suavemente', 'Aplicar con un algodón y retirar.', 'Piel seca o sensible'],
  [/gel (facial )?limpiador|limpiador/, 'Gel limpiador facial', 'Limpia en profundidad sin resecar', 'Aplicar sobre el rostro húmedo, masajear y enjuagar.', null],
  [/serum|sérum/, 'Sérum facial', 'Sérum concentrado de rápida absorción', 'Aplicar unas gotas sobre el rostro limpio antes de la crema.', null],
  [/contorno de ojos/, 'Contorno de ojos', 'Cuidado específico para la piel delicada del contorno de ojos', 'Aplicar con toques suaves mañana y noche.', null],
  [/crema de noche|crema noche|noche/, 'Crema facial de noche', 'Cuidado nocturno que trabaja mientras duermes', 'Aplicar por la noche sobre rostro y cuello limpios.', null],
  [/crema de dia|crema dia|dia fps|día/, 'Crema facial de día', 'Cuidado de día con protección solar', 'Aplicar por la mañana sobre rostro y cuello limpios.', null],
  [/gel de ducha|gel de bano/, 'Gel de ducha', 'Limpia suavemente y deja la piel fresca', 'Aplicar sobre la piel húmeda, hacer espuma y enjuagar.', null],
  [/desodorante|antitranspirante|deo\b/, 'Desodorante antitranspirante', 'Protección antitranspirante para el uso diario, que cuida la piel de las axilas', 'Aplicar sobre las axilas limpias y secas.', null],
  [/shampoo/, 'Shampoo', 'Limpia suavemente el cabello y el cuero cabelludo', 'Aplicar sobre el cabello húmedo, masajear y enjuagar.', null],
  [/acondicionador/, 'Acondicionador', 'Desenreda, suaviza y aporta brillo', 'Aplicar después del shampoo, de medios a puntas, y enjuagar.', null],
  [/mascarilla/, 'Mascarilla capilar', 'Tratamiento intensivo semanal', 'Aplicar sobre el cabello limpio y húmedo, dejar actuar de 3 a 5 minutos y enjuagar.', null],
  [/crema facial|fluido|crema nivea cuidado/, 'Crema facial', 'Hidrata el rostro durante el día', 'Aplicar sobre rostro y cuello limpios.', null],
  [/crema|locion|leche corporal|body|balsamo corporal/, 'Crema corporal', 'Hidrata y suaviza la piel del cuerpo', 'Aplicar sobre la piel limpia, con masaje, hasta su absorción.', null],
  [/guantes/, 'Guantes de nitrilo', 'Guantes desechables sin látex, resistentes a químicos y punciones', 'Usar un par por procedimiento y desechar.', 'Clínicas, laboratorios y limpieza'],
  [/jabon liquido|jabon/, 'Jabón', 'Limpieza diaria de manos y cuerpo', 'Aplicar, hacer espuma y enjuagar.', null],
  [/panales/, 'Pañales', 'Pañales desechables con alta absorción', 'Cambiar con frecuencia y limpiar la piel en cada cambio.', 'Bebés'],
]

function reglas(n) {
  const out = []
  for (const r of COSMETICA) if (r[0].test(n)) out.push(r)
  return out
}

function tipoPielDe(n) {
  if (/piel sensible|sensitive|sensible/.test(n)) return 'Piel sensible'
  if (/extra seca/.test(n)) return 'Piel extra seca'
  if (/normal a seca/.test(n)) return 'Piel normal a seca'
  if (/piel seca|seca/.test(n)) return 'Piel seca'
  if (/mixta|grasa|oil control/.test(n)) return 'Piel mixta a grasa'
  return null
}

function fichaCosmetica(p) {
  const n = norm(p.name)
  const rs = reglas(n)
  if (rs.length === 0) return null
  const tipo = rs.find((r) => r[1])?.[1] ?? null
  const beneficios = [...new Set(rs.map((r) => r[2]).filter(Boolean))].slice(0, 2)
  const modo = rs.find((r) => r[3])?.[3] ?? null
  const para = tipoPielDe(n) ?? rs.find((r) => r[4])?.[4] ?? null
  const contenido = contenidoDe(p.name)
  const fps = p.name.match(/(?:fps|spf)\s*(\d+\+?)/i)?.[1]
  const formato = /roll on/.test(n) ? 'Roll on' : /spray|aerosol/.test(n) ? 'Spray' : /sachet/.test(n) ? 'Sachets' : null

  const partes = []
  const titular = p.description?.trim() && p.description.trim().length >= 25 ? p.description.trim().replace(/\.?$/, '.') : null
  if (titular) partes.push(titular)
  const beneficio = beneficios.map((b) => b.replace(/\.?$/, '.')).join(' ')
  if (beneficio) partes.push(beneficio)
  if (fps) partes.push(`Factor de protección solar ${fps.toUpperCase()}.`)
  if (contenido) partes.push(`${formato === 'Roll on' ? 'Envase roll on' : formato === 'Spray' ? 'Envase en spray' : 'Contenido'}: ${contenido}.`)
  if (modo) partes.push(`Modo de uso: ${minus(modo)}`)
  if (p.brand) partes.push(`Marca ${p.brand}, distribuido por Química Suiza.`)

  const highlights = [
    tipo,
    para,
    fps ? `FPS ${fps.toUpperCase()}` : null,
    formato && contenido ? `${formato} de ${contenido}` : contenido ? `Contenido: ${contenido}` : null,
    beneficios[0] && beneficios[0].length <= 120 ? beneficios[0] : null,
  ].filter(Boolean)

  return {
    tipo: 'cosmetica',
    descripcion: partes.join(' '),
    highlights: [...new Set(highlights)].slice(0, 5),
    ficha: {
      tipo_producto: tipo ?? undefined,
      indicado_para: para ?? undefined,
      contenido_neto: contenido ?? undefined,
      modo_uso: modo ?? undefined,
    },
  }
}

// ---------------------------------------------------------------------------
// Nutricion
// ---------------------------------------------------------------------------

const NUTRICION = [
  [/neosure/, 'Fórmula para prematuros', 'Fórmula enriquecida para bebés prematuros o de bajo peso al nacer, después del alta hospitalaria', '0 a 12 meses'],
  [/alimentum/, 'Fórmula hipoalergénica', 'Fórmula extensamente hidrolizada para bebés con alergia a la proteína de la leche de vaca', '0 a 12 meses'],
  [/isomil/, 'Fórmula a base de soya', 'Fórmula sin lactosa a base de proteína de soya, para bebés con intolerancia a la lactosa', '0 a 12 meses'],
  [/rice/, 'Fórmula antirreflujo', 'Fórmula espesada con almidón de arroz que ayuda a reducir las regurgitaciones', '0 a 12 meses'],
  [/total comfort.*kid|comfort kid/, 'Leche de crecimiento', 'Leche de crecimiento con proteína parcialmente hidrolizada, de fácil digestión', 'Desde los 3 años'],
  [/total comfort|pro ?sensitive|sensitive eye/, 'Fórmula infantil de fácil digestión', 'Fórmula con proteína parcialmente hidrolizada y baja en lactosa que ayuda a reducir cólicos, gases y molestias digestivas', '0 a 12 meses'],
  [/similac 1|etapa 1/, 'Fórmula infantil etapa 1', 'Fórmula de inicio con oligosacáridos de la leche materna (HMO) que apoyan el sistema inmune', '0 a 6 meses'],
  [/similac 2|etapa 2/, 'Fórmula de continuación etapa 2', 'Fórmula de continuación con HMO, DHA y nutrientes para el desarrollo', '6 a 12 meses'],
  [/similac 3|kid etapa 3|etapa 3/, 'Leche de crecimiento etapa 3', 'Leche de crecimiento con HMO, vitaminas y minerales para el niño pequeño', '1 a 3 años'],
  [/pepti gro/, 'Nutrición pediátrica peptídica', 'Fórmula con proteína hidrolizada de fácil digestión para niños con intolerancia o alergia leve a la proteína de leche', '1 a 13 años'],
  [/pediasure 10|10 a 15/, 'Suplemento para adolescentes', 'Nutrición completa y balanceada para acompañar el crecimiento en la adolescencia', '10 a 15 años'],
  [/pediasure/, 'Suplemento nutricional pediátrico', 'Nutrición completa y balanceada con proteína, vitaminas y minerales que apoya el crecimiento de niños con bajo apetito', '1 a 13 años'],
  [/glucerna/, 'Nutrición para personas con diabetes', 'Nutrición especializada de liberación lenta de carbohidratos que ayuda a controlar la glucosa', 'Adultos'],
  [/hmb|ensure advance/, 'Suplemento nutricional adulto', 'Nutrición completa con proteína y HMB que ayuda a mantener la masa y fuerza muscular', 'Adultos'],
  [/ensure clinical/, 'Nutrición clínica', 'Alimento completo de alta proteína para la recuperación en pacientes', 'Adultos'],
  [/ensure/, 'Suplemento nutricional adulto', 'Nutrición completa y balanceada con proteína, vitaminas y minerales', 'Adultos'],
  [/prosure/, 'Nutrición oncológica', 'Suplemento hiperproteico con EPA para pacientes con pérdida de peso por cáncer', 'Adultos'],
  [/nepro/, 'Nutrición renal', 'Nutrición especializada para pacientes con enfermedad renal en diálisis', 'Adultos'],
  [/pulmocare/, 'Nutrición pulmonar', 'Nutrición alta en grasa y baja en carbohidratos para pacientes con enfermedad pulmonar', 'Adultos'],
  [/oxepa/, 'Nutrición enteral para paciente crítico', 'Fórmula enteral con EPA y antioxidantes para pacientes críticos', 'Uso hospitalario'],
  [/osmolite/, 'Nutrición enteral isotónica', 'Fórmula completa e isotónica para alimentación por sonda o vía oral', 'Adultos'],
  [/alitraq/, 'Nutrición enteral especializada', 'Fórmula elemental con glutamina para pacientes con alteraciones gastrointestinales', 'Adultos'],
  [/alterna/, 'Nutrición enteral peptídica', 'Fórmula peptídica completa de fácil absorción para pacientes con mala digestión', 'Adultos'],
  [/pedialyte/, 'Solución de rehidratación oral', 'Repone agua y electrolitos perdidos por diarrea, vómitos o calor', 'Niños y adultos'],
  [/sim-12|sim 12/, 'Suplemento de vitamina B12', 'Suplemento de vitamina B12 que contribuye a la formación de glóbulos rojos y al sistema nervioso', 'Adultos'],
]

function fichaNutricion(p) {
  const n = norm(p.name)
  const r = NUTRICION.find(([re]) => re.test(n))
  if (!r) return null
  const [, tipo, beneficio, edad] = r
  const contenido = contenidoDe(p.name)
  const sabor = n.match(/\b(vainilla|chocolate|fresa platano|fresa|cappuccino|cereza|manzana|uva|mandarina)\b/)?.[1]
  const formato = /liquido|luquido|liq\b|fco|botella|suspension|sol oral|\b\d+ ?ml\b/.test(n) ? 'Líquido listo para tomar' : /sachet/.test(n) ? 'Polvo en sachets' : 'Polvo'
  const infantil = /0 a|6 a 12|1 a 3/.test(edad) && !/pedialyte/.test(n)

  const partes = []
  if (p.description?.trim() && p.description.trim().length >= 25) partes.push(p.description.trim().replace(/\.?$/, '.'))
  partes.push(`${beneficio}.`)
  partes.push(`${formato}${sabor ? `, sabor ${sabor.replace('platano', 'plátano')}` : ''}${contenido ? `, ${contenido}` : ''}. Edad recomendada: ${minus(edad)}.`)
  if (infantil) {
    partes.push('La leche materna es el mejor alimento para el lactante. Usar bajo indicación del pediatra y preparar según las instrucciones del envase.')
  } else if (/pedialyte/.test(n)) {
    partes.push('Ante diarrea con fiebre, sangre o que dura más de dos días, consulta a tu médico.')
  } else {
    partes.push('Úsalo como complemento de una alimentación variada. Consulta a tu médico o nutricionista si tienes una condición especial.')
  }
  if (p.brand) partes.push(`Marca ${p.brand}.`)

  return {
    tipo: 'nutricion',
    descripcion: partes.join(' '),
    highlights: [tipo, `Edad recomendada: ${edad}`, sabor ? `Sabor ${sabor.replace('platano', 'plátano')}` : null, contenido ? `${formato}: ${contenido}` : formato].filter(Boolean),
    ficha: {
      tipo_producto: tipo,
      edad_recomendada: edad,
      contenido_neto: contenido ?? undefined,
      indicado_para: beneficio.length <= 120 ? undefined : undefined,
    },
    sabor,
  }
}

// ---------------------------------------------------------------------------

/** La ficha completa de un producto, o null si no hay con que hacerla. */
export function fichaDe(producto) {
  // Las descripciones del ERP vienen de un PDF: «ﬂ» llega como un caracter de
  // control (U+001E) y los saltos de linea, sueltos.
  const description = producto.description
    ?.replace(/\u001e/g, 'fl')
    .replace(/[\u0000-\u001f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  const p = { ...producto, description }
  return fichaMedicamento(p) ?? fichaNutricion(p) ?? fichaCosmetica(p)
}

export const _internos = { dosisDe, unidadesDe, contenidoDe, formaDe, marcaComercial, principioLegible }
