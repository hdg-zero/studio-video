import '@fontsource/space-grotesk/400.css';
import '@fontsource/space-grotesk/500.css';
import '@fontsource/space-grotesk/600.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles.css';
import { render } from 'preact';
import { App } from './components/App.js';
import { connect } from './store.js';

connect();
const root = document.getElementById('app');
if (root) render(<App />, root);
