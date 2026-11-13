/**
 * Lo que se sabe de cada principio activo del catalogo de Quimica Suiza.
 *
 * `uso` es la indicacion GENERAL del principio activo, la que trae cualquier
 * vademecum, redactada para el comprador y sin dosis: la dosis la pone el
 * medico. Decision del operador (2026-11-13): «informativa + uso», y siempre
 * con el aviso de leer el prospecto.
 *
 * `venta`:
 *   L = venta libre
 *   R = con receta medica
 *   C = controlado (estupefaciente o psicotropico): receta especial retenida
 *
 * La clave se busca DENTRO del principio activo normalizado (minusculas, sin
 * tildes), de la mas larga a la mas corta: «tramadol + paracetamol» gana a
 * «tramadol», y «amlodipino olmesartan hidroclorotiazida» a «olmesartan».
 */
export const FARMACOS = [
  // Sistema nervioso
  ['metilfenidato', 'Psicoestimulante', 'Tratamiento del trastorno por déficit de atención e hiperactividad (TDAH), como parte de un programa integral', 'C'],
  ['lisdexanfetamina', 'Psicoestimulante', 'Tratamiento del trastorno por déficit de atención e hiperactividad (TDAH) en niños desde los 6 años y adultos', 'C'],
  ['quetiapina', 'Antipsicótico atípico', 'Tratamiento de la esquizofrenia y del trastorno bipolar', 'R'],
  ['lurasidona', 'Antipsicótico atípico', 'Tratamiento de la esquizofrenia y de la depresión bipolar', 'R'],
  ['cariprazina', 'Antipsicótico atípico', 'Tratamiento de la esquizofrenia y del trastorno bipolar', 'R'],
  ['risperidona', 'Antipsicótico atípico', 'Tratamiento de la esquizofrenia y de los episodios maníacos del trastorno bipolar', 'R'],
  ['sertralina', 'Antidepresivo (ISRS)', 'Tratamiento de la depresión y de los trastornos de ansiedad, de pánico y obsesivo-compulsivo', 'R'],
  ['desvenlafaxina', 'Antidepresivo (IRSN)', 'Tratamiento del trastorno depresivo mayor en adultos', 'R'],
  ['mirtazapina', 'Antidepresivo', 'Tratamiento de los episodios de depresión mayor', 'R'],
  ['ketazolam', 'Ansiolítico (benzodiacepina)', 'Tratamiento de la ansiedad y de la tensión nerviosa', 'C'],
  ['pregabalina', 'Antiepiléptico y analgésico neuropático', 'Tratamiento del dolor neuropático, de la epilepsia y del trastorno de ansiedad generalizada', 'R'],
  ['brivaracetam', 'Antiepiléptico', 'Tratamiento complementario de las crisis epilépticas de inicio parcial', 'R'],
  ['lacosamida', 'Antiepiléptico', 'Tratamiento de las crisis epilépticas de inicio parcial', 'R'],
  ['topiramato', 'Antiepiléptico', 'Tratamiento de la epilepsia y prevención de la migraña', 'R'],
  ['donepezilo memantina', 'Antidemencia', 'Tratamiento de la enfermedad de Alzheimer moderada a grave', 'R'],
  ['donepezilo', 'Antidemencia (inhibidor de la acetilcolinesterasa)', 'Tratamiento sintomático de la enfermedad de Alzheimer', 'R'],
  ['memantina', 'Antidemencia', 'Tratamiento de la enfermedad de Alzheimer moderada a grave', 'R'],
  ['pramipexol', 'Antiparkinsoniano (agonista dopaminérgico)', 'Tratamiento de la enfermedad de Parkinson y del síndrome de piernas inquietas', 'R'],
  ['betahistina', 'Antivertiginoso', 'Tratamiento del vértigo, los zumbidos y la pérdida de audición del síndrome de Ménière', 'R'],
  ['citicolina nimodipino', 'Vasodilatador cerebral y neuroprotector', 'Tratamiento de los trastornos de la circulación cerebral y del deterioro cognitivo de origen vascular', 'R'],
  ['nimodipi', 'Vasodilatador cerebral (antagonista del calcio)', 'Tratamiento de los trastornos de la circulación cerebral y del deterioro cognitivo de origen vascular', 'R'],
  ['tapentadol', 'Analgésico opioide', 'Alivio del dolor agudo o crónico intenso que requiere un analgésico opioide', 'C'],
  ['buprenorfina', 'Analgésico opioide (parche transdérmico)', 'Alivio del dolor crónico intenso que requiere un analgésico opioide de liberación continua', 'C'],
  ['celecoxib tramadol', 'Analgésico combinado (AINE + opioide)', 'Alivio del dolor agudo moderado a intenso', 'C'],
  ['tramadol clorhidrato paracetamol', 'Analgésico combinado (opioide + paracetamol)', 'Alivio del dolor moderado a intenso', 'C'],
  ['tramadol', 'Analgésico opioide', 'Alivio del dolor moderado a intenso', 'C'],
  ['codeina fenitoloxamina', 'Antitusivo', 'Alivio de la tos seca e irritativa', 'C'],
  ['codeina guaifenesina', 'Antitusivo y expectorante', 'Alivio de la tos con flema difícil de expulsar', 'C'],
  ['codeina', 'Antitusivo', 'Alivio de la tos seca e irritativa', 'C'],
  ['metamizol', 'Analgésico y antipirético', 'Alivio del dolor intenso y de la fiebre que no responde a otros antipiréticos', 'R'],
  ['paracetamol', 'Analgésico y antipirético', 'Alivio del dolor leve a moderado y de la fiebre', 'L'],
  ['lidocaina', 'Anestésico local (parche)', 'Alivio del dolor neuropático localizado tras un herpes zóster (neuralgia postherpética)', 'R'],
  ['dimenhidrinato', 'Antiemético y antivertiginoso', 'Prevención y alivio de las náuseas, los vómitos y el mareo por movimiento', 'L'],

  // Sistema cardiovascular y metabolismo
  ['amlodipino olmesartan hidroclorotiazida', 'Antihipertensivo combinado', 'Tratamiento de la hipertensión arterial no controlada con dos fármacos', 'R'],
  ['amlodipino olmesartan', 'Antihipertensivo combinado (ARA II + antagonista del calcio)', 'Tratamiento de la hipertensión arterial', 'R'],
  ['olmesartan hidroclorotiazida', 'Antihipertensivo combinado (ARA II + diurético)', 'Tratamiento de la hipertensión arterial', 'R'],
  ['olmesartan', 'Antihipertensivo (ARA II)', 'Tratamiento de la hipertensión arterial', 'R'],
  ['amlodipino', 'Antihipertensivo (antagonista del calcio)', 'Tratamiento de la hipertensión arterial y de la angina de pecho', 'R'],
  ['nebivolol', 'Antihipertensivo (betabloqueador)', 'Tratamiento de la hipertensión arterial y de la insuficiencia cardiaca crónica', 'R'],
  ['sacubitrilo valsartan', 'Tratamiento de la insuficiencia cardiaca', 'Tratamiento de la insuficiencia cardiaca crónica con fracción de eyección reducida', 'R'],
  ['rosuvastatina ezetimiba', 'Hipolipemiante combinado', 'Reducción del colesterol LDL cuando la estatina sola no es suficiente', 'R'],
  ['atorvastatina', 'Hipolipemiante combinado', 'Reducción del colesterol LDL cuando la estatina sola no es suficiente', 'R'],
  ['bempedoico ezetimiba', 'Hipolipemiante combinado', 'Reducción del colesterol LDL en adultos con hipercolesterolemia', 'R'],
  ['bempedoico', 'Hipolipemiante', 'Reducción del colesterol LDL en adultos con hipercolesterolemia', 'R'],
  ['apixaban', 'Anticoagulante oral', 'Prevención del ictus en fibrilación auricular y tratamiento de la trombosis venosa', 'R'],
  ['clopidogrel', 'Antiagregante plaquetario', 'Prevención de eventos aterotrombóticos tras un infarto, un ictus o con enfermedad arterial periférica', 'R'],
  ['cilostazol', 'Antiagregante y vasodilatador', 'Mejora de la distancia que se camina sin dolor en la claudicación intermitente', 'R'],
  ['acetilsalicilico', 'Antiagregante plaquetario', 'Prevención de eventos cardiovasculares en personas con riesgo, según indicación médica', 'R'],
  ['empagliflozina', 'Antidiabético oral (iSGLT2)', 'Control de la glucosa en la diabetes tipo 2; también indicado en insuficiencia cardiaca', 'R'],
  ['dapagliflozina', 'Antidiabético oral (iSGLT2)', 'Control de la glucosa en la diabetes tipo 2, insuficiencia cardiaca y enfermedad renal crónica', 'R'],
  ['sitagliptina', 'Antidiabético oral (iDPP-4)', 'Control de la glucosa en la diabetes tipo 2', 'R'],
  ['glibenclamida metformina', 'Antidiabético oral combinado', 'Control de la glucosa en la diabetes tipo 2', 'R'],
  ['metformina', 'Antidiabético oral (biguanida)', 'Control de la glucosa en la diabetes tipo 2', 'R'],
  ['fentermina', 'Tratamiento de la obesidad', 'Apoyo a la pérdida de peso en adultos con obesidad, junto con dieta y ejercicio', 'C'],
  ['bupropion naltrexona', 'Tratamiento de la obesidad', 'Apoyo al control del peso en adultos con obesidad o sobrepeso con comorbilidades', 'R'],
  ['tiamazol', 'Antitiroideo', 'Tratamiento del hipertiroidismo', 'R'],

  // Aparato digestivo
  ['dexlansoprazol', 'Inhibidor de la bomba de protones', 'Tratamiento de la enfermedad por reflujo gastroesofágico y de la esofagitis erosiva', 'R'],
  ['mosaprida', 'Procinético', 'Alivio de los síntomas digestivos como llenura, náuseas y acidez por vaciamiento gástrico lento', 'R'],
  ['polietilenglicol', 'Laxante osmótico', 'Tratamiento del estreñimiento y preparación intestinal según indicación', 'L'],
  ['bismuto', 'Antidiarreico y protector gástrico', 'Alivio de la diarrea, la indigestión, la acidez y las náuseas', 'L'],
  ['bifidobacterium', 'Probiótico', 'Ayuda a equilibrar la flora intestinal durante y después de una diarrea o un tratamiento antibiótico', 'L'],
  ['electrolitos', 'Solución de rehidratación oral', 'Reposición de agua y electrolitos en diarreas, vómitos o pérdida de líquidos', 'L'],
  ['policresuleno', 'Antihemorroidal', 'Alivio del dolor, el picor y la inflamación de las hemorroides', 'L'],

  // Antiinfecciosos
  ['levofloxacino', 'Antibiótico (quinolona)', 'Tratamiento de infecciones bacterianas respiratorias, urinarias y de la piel', 'R'],
  ['ciprofloxacino', 'Antibiótico (quinolona)', 'Tratamiento de infecciones bacterianas urinarias, respiratorias y digestivas', 'R'],
  ['ofloxacino', 'Antibiótico ótico (quinolona)', 'Tratamiento de la otitis externa bacteriana', 'R'],
  ['azitromicina', 'Antibiótico (macrólido)', 'Tratamiento de infecciones bacterianas respiratorias, de la piel y de transmisión sexual', 'R'],
  ['claritromicina', 'Antibiótico (macrólido)', 'Tratamiento de infecciones bacterianas respiratorias y de la piel', 'R'],
  ['eritromicina', 'Antibiótico (macrólido)', 'Tratamiento de infecciones bacterianas respiratorias y de la piel', 'R'],
  ['doxiciclina', 'Antibiótico (tetraciclina)', 'Tratamiento de infecciones bacterianas respiratorias, de la piel y del acné', 'R'],
  ['cefaclor', 'Antibiótico (cefalosporina)', 'Tratamiento de infecciones bacterianas respiratorias, de oído y urinarias', 'R'],
  ['fenoximetilpenicilina', 'Antibiótico (penicilina)', 'Tratamiento de infecciones de garganta y de la piel por estreptococo', 'R'],
  ['bencilpenicilina', 'Antibiótico (penicilina de depósito)', 'Tratamiento de la faringoamigdalitis estreptocócica y prevención de la fiebre reumática', 'R'],
  ['sulfametoxazol', 'Antibiótico con expectorante', 'Tratamiento de infecciones respiratorias bacterianas con flema', 'R'],
  ['neomicina sulfato bacitracina', 'Antibiótico y anestésico ótico', 'Tratamiento de la otitis externa con dolor', 'R'],
  ['clindamicina', 'Antibiótico vaginal', 'Tratamiento de la vaginosis bacteriana', 'R'],
  ['ketoconazol clindamicina', 'Antimicótico y antibiótico vaginal', 'Tratamiento de las infecciones vaginales mixtas por hongos y bacterias', 'R'],
  ['fluconazol', 'Antimicótico oral', 'Tratamiento de la candidiasis vaginal y de otras infecciones por hongos', 'R'],
  ['fenticonazol', 'Antimicótico vaginal', 'Tratamiento de la candidiasis vaginal', 'R'],
  ['butoconazol', 'Antimicótico vaginal', 'Tratamiento de la candidiasis vaginal', 'R'],
  ['clotrimazol gentamicina betametasona', 'Antimicótico, antibiótico y corticoide tópico', 'Tratamiento de dermatitis con infección por hongos o bacterias', 'R'],
  ['clotrimazol', 'Antimicótico vaginal', 'Tratamiento de la candidiasis vaginal', 'L'],
  ['nistatina', 'Antimicótico y protector cutáneo', 'Prevención y tratamiento de la dermatitis del pañal con infección por hongos', 'L'],
  ['nitazoxanida', 'Antiparasitario', 'Tratamiento de la diarrea por parásitos intestinales como Giardia y Cryptosporidium', 'R'],
  ['praziquantel', 'Antiparasitario', 'Tratamiento de infecciones por tenias y otros gusanos planos', 'R'],

  // Musculoesqueletico y dolor
  ['pridinol meloxicam', 'Relajante muscular y antiinflamatorio', 'Alivio del dolor con contractura muscular', 'R'],
  ['meloxicam', 'Antiinflamatorio no esteroideo (AINE)', 'Alivio del dolor y la inflamación en artrosis y artritis', 'R'],
  ['celecoxib', 'Antiinflamatorio (inhibidor COX-2)', 'Alivio del dolor y la inflamación en artrosis y artritis', 'R'],
  ['naproxeno', 'Antiinflamatorio no esteroideo (AINE)', 'Alivio del dolor y la inflamación musculares, articulares y menstruales', 'L'],
  ['dexketoprofeno', 'Antiinflamatorio no esteroideo (AINE)', 'Alivio del dolor agudo leve a moderado', 'R'],
  ['diclofenaco', 'Antiinflamatorio no esteroideo (AINE)', 'Alivio del dolor y la inflamación musculares y articulares', 'R'],
  ['clorzoxazona', 'Relajante muscular con analgésico', 'Alivio del dolor con contractura muscular', 'R'],
  ['orfenadrina', 'Relajante muscular', 'Alivio del dolor por espasmo muscular agudo', 'R'],
  ['ciclobenzaprina', 'Relajante muscular', 'Alivio del espasmo muscular asociado a lesiones musculoesqueléticas agudas', 'R'],
  ['baclofeno', 'Relajante muscular', 'Tratamiento de la espasticidad muscular', 'R'],
  ['glucosamina', 'Condroprotector', 'Alivio de los síntomas de la artrosis leve a moderada', 'L'],
  ['persea americana', 'Condroprotector (insaponificables de palta y soya)', 'Alivio de los síntomas de la artrosis de rodilla y cadera', 'R'],
  ['hialuronato', 'Viscosuplemento articular', 'Alivio del dolor de rodilla por artrosis, aplicado por el médico', 'R'],
  ['denosumab', 'Tratamiento de la osteoporosis', 'Tratamiento de la osteoporosis posmenopáusica con alto riesgo de fractura', 'R'],
  ['ibandronico', 'Tratamiento de la osteoporosis (bifosfonato)', 'Tratamiento de la osteoporosis posmenopáusica', 'R'],
  ['capsaicina', 'Analgésico tópico (parche)', 'Alivio del dolor muscular y articular localizado', 'L'],
  ['arnica', 'Antiinflamatorio tópico de origen natural (parche)', 'Alivio de golpes, contusiones y dolores musculares', 'L'],
  ['prednisona', 'Corticoide', 'Tratamiento de enfermedades inflamatorias, alérgicas y autoinmunes', 'R'],

  // Genitourinario y hormonas
  ['dutasterida', 'Tratamiento de la hiperplasia prostática', 'Alivio de los síntomas urinarios por crecimiento benigno de la próstata', 'R'],
  ['tamsulosina solifenacina', 'Tratamiento urológico combinado', 'Alivio de los síntomas urinarios de llenado y vaciado por hiperplasia prostática', 'R'],
  ['tamsulosina', 'Alfabloqueador urológico', 'Alivio de los síntomas urinarios por hiperplasia benigna de próstata', 'R'],
  ['finasterida', 'Tratamiento de la hiperplasia prostática', 'Reducción del tamaño de la próstata y alivio de los síntomas urinarios', 'R'],
  ['oxibutinina', 'Antiespasmódico urinario', 'Tratamiento de la vejiga hiperactiva y la incontinencia de urgencia', 'R'],
  ['flavoxato', 'Antiespasmódico urinario', 'Alivio del dolor y la urgencia urinaria por cistitis o uretritis', 'R'],
  ['sildenafilo', 'Tratamiento de la disfunción eréctil', 'Tratamiento de la disfunción eréctil en adultos', 'R'],
  ['tadalafilo', 'Tratamiento de la disfunción eréctil', 'Tratamiento de la disfunción eréctil en adultos', 'R'],
  ['cabergolina', 'Inhibidor de la prolactina', 'Tratamiento de la hiperprolactinemia y supresión de la lactancia', 'R'],
  ['progesterona', 'Hormona (progestágeno)', 'Tratamiento de la insuficiencia de progesterona y apoyo de la fase lútea', 'R'],
  ['dienogest', 'Anticonceptivo oral', 'Anticoncepción hormonal', 'R'],
  ['clormadinona', 'Anticonceptivo oral', 'Anticoncepción hormonal', 'R'],
  ['levonorgestrel', 'Anticonceptivo oral', 'Anticoncepción hormonal', 'R'],

  // Sangre, vitaminas y respiratorio
  ['hierro iii polimaltosado acido folico', 'Antianémico (hierro + ácido fólico)', 'Prevención y tratamiento de la anemia por falta de hierro y ácido fólico, también en el embarazo', 'L'],
  ['hierro', 'Antianémico (hierro)', 'Prevención y tratamiento de la anemia por falta de hierro', 'L'],
  ['hidroxocobalamina', 'Vitamina B12', 'Tratamiento de la deficiencia de vitamina B12', 'R'],
  ['cianocobalamina', 'Vitamina B12', 'Tratamiento de la deficiencia de vitamina B12', 'R'],
  ['cobamamida', 'Vitamina B12 (coenzima)', 'Suplemento de vitamina B12 para estados de deficiencia y desgaste', 'L'],
  ['vit b1 tiamina vit b6', 'Complejo B', 'Alivio de dolores neuríticos y deficiencia de vitaminas B1, B6 y B12', 'L'],
  ['piridoxina acido folico', 'Complejo B inyectable', 'Tratamiento de la deficiencia de vitaminas del complejo B', 'R'],
  ['levocetirizina', 'Antihistamínico', 'Alivio de los síntomas de la rinitis alérgica y la urticaria', 'L'],
]

/** Texto de la condicion de venta, para descripcion y ficha. */
export const VENTA = {
  L: { ficha: 'Venta libre', frase: 'Medicamento de venta libre.' },
  R: {
    ficha: 'Con receta médica',
    frase: 'Venta bajo receta médica: la botica valida la receta antes de despachar el pedido.',
  },
  C: {
    ficha: 'Receta especial (controlado)',
    frase:
      'Medicamento controlado: se despacha solo con receta médica especial, que la botica retiene.',
  },
}

export const norm = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const ORDENADOS = [...FARMACOS].sort((a, b) => b[0].length - a[0].length)

/** El farmaco del diccionario que corresponde a un principio activo, o null. */
export function farmacoDe(principio) {
  const n = norm(principio)
  if (!n) return null
  for (const [clave, grupo, uso, venta] of ORDENADOS) {
    const partes = clave.split(' ')
    if (partes.every((p) => n.includes(p))) return { grupo, uso, venta }
  }
  return null
}
