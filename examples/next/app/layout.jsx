import Elements from './elements.jsx';

export const metadata = {
  title: 'medkit with Next.js',
  description: "medkit's image, background video and player in a Next.js app, processed by `medkit process` before the build.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, font: '1.125rem/1.5 system-ui, sans-serif', color: '#111' }}>
        {children}
        <Elements />
      </body>
    </html>
  );
}
