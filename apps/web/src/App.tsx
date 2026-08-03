import { AppShell } from './App/AppShell.js';
import { ThemeProvider } from './theme/ThemeProvider.js';

export function App() {
  return (
    <ThemeProvider>
      <AppShell />
    </ThemeProvider>
  );
}
