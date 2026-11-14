import { useEffect, useState } from 'react';
import { Keyboard } from 'react-native';

/**
 * Height of the on-screen keyboard (0 when hidden).
 *
 * Used to keep bottom-aligned controls (the chat composer) clear of the
 * keyboard and of the home indicator.
 */
export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (event) => {
      setHeight(event.endCoordinates?.height ?? 0);
    });
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));

    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  return height;
}
