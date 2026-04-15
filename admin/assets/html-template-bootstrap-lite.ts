import React from 'react';
import { createRoot } from 'react-dom/client';

type BootstrapOptions = {
  container?: HTMLElement;
  config?: Record<string, unknown>;
  data?: Record<string, unknown>;
  events?: Record<string, unknown>;
};

function renderComponent(Component: any, props?: BootstrapOptions) {
  const container = props?.container ?? document.getElementById('root');
  if (!container) return;

  const mergedProps: BootstrapOptions = props ?? { container, config: {}, data: {}, events: {} };
  createRoot(container).render(React.createElement(Component, mergedProps));
}

const ReactDOM = { createRoot };

if (typeof window !== 'undefined') {
  (window as any).HtmlTemplateBootstrap = { renderComponent, React, ReactDOM };
}

