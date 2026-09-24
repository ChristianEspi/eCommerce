import BlenderRoundedIcon from '@mui/icons-material/BlenderRounded'
import BuildRoundedIcon from '@mui/icons-material/BuildRounded'
import CategoryRoundedIcon from '@mui/icons-material/CategoryRounded'
import ChairRoundedIcon from '@mui/icons-material/ChairRounded'
import ChildCareRoundedIcon from '@mui/icons-material/ChildCareRounded'
import ContentCutRoundedIcon from '@mui/icons-material/ContentCutRounded'
import DevicesOtherRoundedIcon from '@mui/icons-material/DevicesOtherRounded'
import DirectionsCarRoundedIcon from '@mui/icons-material/DirectionsCarRounded'
import ElderlyRoundedIcon from '@mui/icons-material/ElderlyRounded'
import FitnessCenterRoundedIcon from '@mui/icons-material/FitnessCenterRounded'
import HealingRoundedIcon from '@mui/icons-material/HealingRounded'
import LocalDrinkRoundedIcon from '@mui/icons-material/LocalDrinkRounded'
import LocalPharmacyRoundedIcon from '@mui/icons-material/LocalPharmacyRounded'
import MedicalServicesRoundedIcon from '@mui/icons-material/MedicalServicesRounded'
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded'
import MonitorHeartRoundedIcon from '@mui/icons-material/MonitorHeartRounded'
import PetsRoundedIcon from '@mui/icons-material/PetsRounded'
import PsychologyRoundedIcon from '@mui/icons-material/PsychologyRounded'
import RestaurantRoundedIcon from '@mui/icons-material/RestaurantRounded'
import SanitizerRoundedIcon from '@mui/icons-material/SanitizerRounded'
import SmartToyRoundedIcon from '@mui/icons-material/SmartToyRounded'
import SpaRoundedIcon from '@mui/icons-material/SpaRounded'
import SportsSoccerRoundedIcon from '@mui/icons-material/SportsSoccerRounded'
import StyleRoundedIcon from '@mui/icons-material/StyleRounded'
import VaccinesRoundedIcon from '@mui/icons-material/VaccinesRounded'
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded'
import WatchRoundedIcon from '@mui/icons-material/WatchRounded'
import WaterDropRoundedIcon from '@mui/icons-material/WaterDropRounded'
import type { ComponentType } from 'react'

/**
 * La cara de una familia del catálogo, elegida por su NOMBRE.
 *
 * ## Por qué vive en `shared` desde Storefront V2 · P03
 *
 * Porque ahora la usan los dos lados. La vitrina la usaba para la barra de
 * familias y las puertas de la portada; el backoffice la necesita para enseñar
 * el respaldo REAL en el cajón de la categoría — la caja que se ve cuando no
 * hay foto tiene que ser la que verá el comprador, no un rectángulo gris que
 * sugiere que falta algo.
 *
 * ## Por qué se elige por palabra y no por un campo
 *
 * El comercio no tiene dónde declarar un icono, y pedirle que rellene uno para
 * que su tienda no se vea gris es cobrarle nuestro problema. Sin coincidencia va
 * el icono genérico: en una barra de ocho entradas, un hueco vacío descuadra la
 * fila entera.
 *
 * ## La tabla es MULTI-INDUSTRIA, y eso hubo que arreglarlo
 *
 * La lista original tenía catorce entradas y diez eran de farmacia
 * —`medicamento`, `dermo`, `cardio`, `oftalm`…—. No era una condición por rubro
 * (nadie pregunta a qué se dedica el comercio) pero el efecto se notaba: una
 * botica tenía icono para cada familia y una zapatería no tenía ninguno, así que
 * sus puertas se veían todas iguales.
 *
 * Ahora cubre calzado y moda, hogar, alimentación, ferretería, tecnología,
 * deporte, juguetes, mascotas, papelería, automoción y belleza, además de las de
 * salud, que siguen siendo tan legítimas como el resto. Las de salud NO se
 * quitaron: quitarlas sería el mismo error del revés.
 *
 * **El orden importa.** Se recorre de arriba abajo y gana la primera
 * coincidencia, así que lo específico va antes que lo genérico: `zapatilla`
 * antes que `calzado`, y `cuidado personal` al final porque «cuidado» aparece
 * dentro de medio catálogo.
 */
const ICONOS: readonly (readonly [readonly string[], ComponentType<{ sx?: object }>])[] = [
  // --- Salud y farmacia ---------------------------------------------------
  [['medicamento', 'farmac', 'etico', 'generico', 'drug'], LocalPharmacyRoundedIcon],
  [['vitamina', 'suplemento', 'nutric', 'vitamin'], VaccinesRoundedIcon],
  [['dispositivo', 'instrumental', 'ortoped', 'device'], MedicalServicesRoundedIcon],
  [['cardio', 'presion', 'corazon', 'diabet', 'heart'], MonitorHeartRoundedIcon],
  [['nervioso', 'neuro', 'psiq', 'sueno', 'nerve'], PsychologyRoundedIcon],
  [['ocular', 'oftalm', 'ojo', 'vision', 'eye', 'gafa', 'lente'], VisibilityRoundedIcon],
  [['adulto mayor', 'geriatr', 'senior'], ElderlyRoundedIcon],
  // --- Moda, calzado y accesorios -----------------------------------------
  [
    ['zapat', 'calzado', 'sandalia', 'bota', 'zapatilla', 'sneaker', 'shoe', 'footwear'],
    StyleRoundedIcon,
  ],
  [
    ['ropa', 'vestido', 'abrigo', 'camisa', 'pantalon', 'moda', 'prenda', 'apparel', 'clothing'],
    StyleRoundedIcon,
  ],
  [['bolso', 'cartera', 'mochila', 'accesorio', 'reloj', 'joy', 'bag', 'watch'], WatchRoundedIcon],
  // --- Belleza y cuidado --------------------------------------------------
  [['dermo', 'cosmet', 'piel', 'facial', 'skin', 'belleza', 'maquillaje', 'beauty'], SpaRoundedIcon],
  [['afeitad', 'cabello', 'capilar', 'shav', 'hair', 'peluquer'], ContentCutRoundedIcon],
  [['perfum', 'fragancia', 'colonia', 'desodorante', 'antitranspirante', 'deo'], WaterDropRoundedIcon],
  [['bebe', 'infantil', 'nino', 'mama', 'baby'], ChildCareRoundedIcon],
  // --- Alimentación y bebidas ---------------------------------------------
  [['bebida', 'gaseosa', 'jugo', 'agua', 'vino', 'cerveza', 'licor', 'drink'], LocalDrinkRoundedIcon],
  [
    ['abarrote', 'aliment', 'comida', 'snack', 'panader', 'lacte', 'carne', 'grocer', 'food'],
    RestaurantRoundedIcon,
  ],
  // --- Hogar, ferretería y electrodomésticos ------------------------------
  [['electrodomestic', 'cocina', 'appliance'], BlenderRoundedIcon],
  [['mueble', 'hogar', 'decoracion', 'colchon', 'furnitur', 'home'], ChairRoundedIcon],
  [
    ['herramient', 'ferreter', 'pintura', 'electricidad', 'construc', 'tool', 'hardware'],
    BuildRoundedIcon,
  ],
  // --- Tecnología, deporte, juguetes, mascotas, papelería, auto -----------
  [
    ['celular', 'computador', 'laptop', 'audio', 'tecnolog', 'electronic', 'phone', 'tv'],
    DevicesOtherRoundedIcon,
  ],
  [['deporte', 'fitness', 'gimnasio', 'pesa', 'sport'], FitnessCenterRoundedIcon],
  [['futbol', 'pelota', 'balon', 'soccer', 'outdoor', 'camping'], SportsSoccerRoundedIcon],
  [['juguete', 'juego', 'toy'], SmartToyRoundedIcon],
  [['mascota', 'perro', 'gato', 'pet'], PetsRoundedIcon],
  [['oficina', 'papeler', 'libro', 'escolar', 'office', 'book'], MenuBookRoundedIcon],
  [['automotriz', 'auto', 'repuesto', 'llanta', 'moto', 'car'], DirectionsCarRoundedIcon],
  // --- Genéricos, al final: «limpieza» y «cuidado» caben en medio catálogo.
  [['higiene', 'limpieza', 'antisep', 'hygiene', 'cleaning'], SanitizerRoundedIcon],
  [['cuidado', 'personal', 'care'], HealingRoundedIcon],
]

export function iconoDe(nombre: string): ComponentType<{ sx?: object }> {
  const limpio = nombre
    .toLowerCase()
    .normalize('NFD')
    // Sin acentos: «Nutrición» y «Nutricion» son la misma familia escrita de dos
    // formas, y la tabla no puede tener las dos.
    .replace(/[̀-ͯ]/g, '')
  for (const [palabras, Icono] of ICONOS) {
    if (palabras.some((palabra) => limpio.includes(palabra))) return Icono
  }
  return CategoryRoundedIcon
}

