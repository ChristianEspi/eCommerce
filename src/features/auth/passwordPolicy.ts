/**
 * 8 caracteres es el mínimo por defecto de Supabase Auth; no se relaja aquí.
 * Una sola constante para fijar la clave nueva y para crear una cuenta: dos
 * pantallas con dos mínimos distintos es el tipo de detalle que acaba en «a
 * veces me deja y a veces no».
 */
export const MIN_PASSWORD_LENGTH = 8

/**
 * 72 es lo más que Supabase Auth (bcrypt) tiene en cuenta: lo que pase de ahí
 * se ignoraría sin avisar. La clave no se filtra —cualquier carácter vale—;
 * solo se corta en el máximo.
 */
export const PASSWORD_MAX_LENGTH = 72
