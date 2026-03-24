import { useState, useRef, useEffect, Component, ErrorInfo, ReactNode } from 'react';
import { 
  Send, Bot, User, Loader2, Mic, MicOff, Trash2, Copy, Check, Plus, 
  MessageSquare, Menu, X, LogIn, LogOut, Image as ImageIcon, Video, 
  Volume2, Search, MapPin, Sparkles, Brain, Settings, Paperclip, Play, Pause,
  ChevronRight, UserPlus, Zap, Palette, LifeBuoy, ChevronUp
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import ReactMarkdown from 'react-markdown';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism';
import { 
  askMiniGPT, generateImage, generateVideo, textToSpeech, analyzeMultimodal, ai, generateChatTitle 
} from './gemini';
import { 
  auth, db, googleProvider, signInWithPopup, signOut, onAuthStateChanged, 
  collection, doc, setDoc, getDoc, updateDoc, deleteDoc, onSnapshot, 
  query, orderBy, where, limit, Timestamp, User as FirebaseUser 
} from './firebase';
import { ThinkingLevel, Modality } from "@google/genai";

declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  type?: 'text' | 'image' | 'video' | 'audio';
  url?: string;
  grounding?: any[];
  createdAt: number;
}

interface Chat {
  id: string;
  title: string;
  createdAt: number;
  userId: string;
  lastMessage?: string;
}

// Error Handling Spec for Firestore
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// Error Boundary Component
class ErrorBoundary extends Component<{ children: ReactNode }, { hasError: boolean, error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("ErrorBoundary caught an error", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex flex-col items-center justify-center h-screen p-6 text-center bg-zinc-50">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mb-4">
            <X className="w-8 h-8" />
          </div>
          <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
          <p className="text-zinc-500 mb-4 max-w-md">
            {this.state.error?.message.startsWith('{') 
              ? "A database error occurred. Please try again later." 
              : this.state.error?.message || "An unexpected error occurred."}
          </p>
          <button 
            onClick={() => window.location.reload()}
            className="px-6 py-2 bg-zinc-900 text-white rounded-xl font-medium"
          >
            Reload App
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Declare SpeechRecognition for TypeScript
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

const INITIAL_MESSAGE: Message = { 
  id: '1', 
  text: "Hi there! I'm MiniGPT. How can I help you today?", 
  sender: 'bot',
  createdAt: 0
};

const MAX_MESSAGE_LENGTH = 4000;

function ChatApp() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [chats, setChats] = useState<Chat[]>([]);
  const [currentChatId, setCurrentChatId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  
  // New features state
  const [isThinkingMode, setIsThinkingMode] = useState(false);
  const [isTTSEnabled, setIsTTSEnabled] = useState(false);
  const [isGroundingEnabled, setIsGroundingEnabled] = useState(true);
  const [selectedFile, setSelectedFile] = useState<{ data: string, mimeType: string, name: string } | null>(null);
  const [imageConfig, setImageConfig] = useState({ aspectRatio: '1:1', imageSize: '1K' });
  const [videoConfig, setVideoConfig] = useState({ aspectRatio: '16:9', resolution: '720p' });
  const [isLiveMode, setIsLiveMode] = useState(false);
  const [isLiveActive, setIsLiveActive] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isProfileOpen, setIsProfileOpen] = useState(false);
  const [isPersonalizationOpen, setIsPersonalizationOpen] = useState(false);
  const [isUpgradeOpen, setIsUpgradeOpen] = useState(false);
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState("");
  
  // Pagination state
  const [messages, setMessages] = useState<Message[]>([]);
  const [messageLimit, setMessageLimit] = useState(20);
  const [hasMoreMessages, setHasMoreMessages] = useState(false);
  const [isMessagesLoading, setIsMessagesLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  
  // Live API refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionRef = useRef<any>(null);
  const audioQueueRef = useRef<Int16Array[]>([]);
  const isPlayingRef = useRef(false);

  const currentChat = chats.find(c => c.id === currentChatId);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      setUser(user);
      setIsAuthReady(true);
      if (user) {
        // Sync user to Firestore
        const userRef = doc(db, 'users', user.uid);
        setDoc(userRef, {
          uid: user.uid,
          email: user.email,
          displayName: user.displayName,
          photoURL: user.photoURL,
          updatedAt: Timestamp.now()
        }, { merge: true }).catch(err => handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`));
      } else {
        setChats([]);
        setCurrentChatId(null);
      }
    });
    return () => unsubscribe();
  }, []);

  // Firestore Chats Listener
  useEffect(() => {
    if (!user || !isAuthReady) return;

    const chatsRef = collection(db, 'chats');
    const q = query(chatsRef, where('userId', '==', user.uid), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedChats = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Chat));
      setChats(fetchedChats);
      
      if (fetchedChats.length > 0 && !currentChatId) {
        setCurrentChatId(fetchedChats[0].id);
      } else if (fetchedChats.length === 0) {
        createNewChat();
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, 'chats');
    });

    return () => unsubscribe();
  }, [user, isAuthReady]);

  // Firestore Messages Listener
  useEffect(() => {
    if (!user || !currentChatId) {
      setMessages([]);
      return;
    }

    setIsMessagesLoading(true);
    const messagesRef = collection(db, 'chats', currentChatId, 'messages');
    const q = query(
      messagesRef, 
      orderBy('createdAt', 'desc'), 
      limit(messageLimit)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedMessages = snapshot.docs.map(doc => doc.data() as Message).reverse();
      setMessages(fetchedMessages);
      setHasMoreMessages(snapshot.docs.length === messageLimit);
      setIsMessagesLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `chats/${currentChatId}/messages`);
      setIsMessagesLoading(false);
    });

    return () => unsubscribe();
  }, [user, currentChatId, messageLimit]);

  const loadMoreMessages = () => {
    if (hasMoreMessages && !isMessagesLoading) {
      setMessageLimit(prev => prev + 20);
    }
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, isLoading]);

  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = 'en-US';

      recognition.onstart = () => setIsListening(true);
      recognition.onend = () => setIsListening(false);
      recognition.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setInput(transcript);
      };
      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
        setIsListening(false);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  const login = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error) {
      console.error("Login failed", error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Logout failed", error);
    }
  };

  const addAnotherAccount = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
      setIsUserMenuOpen(false);
    } catch (error) {
      console.error("Failed to add another account", error);
    }
  };

  const toggleListening = () => {
    if (isListening) {
      recognitionRef.current?.stop();
    } else {
      recognitionRef.current?.start();
    }
  };

  const createNewChat = async () => {
    if (!user) return;
    const newChatId = Date.now().toString();
    const newChat: Chat = {
      id: newChatId,
      title: 'New Conversation',
      createdAt: Date.now(),
      userId: user.uid,
      lastMessage: INITIAL_MESSAGE.text
    };
    
    try {
      await setDoc(doc(db, 'chats', newChatId), newChat);
      const initialMsg: Message = { ...INITIAL_MESSAGE, createdAt: Date.now() };
      await setDoc(doc(db, 'chats', newChatId, 'messages', initialMsg.id), initialMsg);
      setCurrentChatId(newChatId);
      if (window.innerWidth < 768) setIsSidebarOpen(false);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `chats/${newChatId}`);
    }
  };

  const deleteChat = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await deleteDoc(doc(db, 'chats', id));
      if (currentChatId === id) {
        setCurrentChatId(null);
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `chats/${id}`);
    }
  };

  const copyToClipboard = async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
    }
  };

  const renameChat = async (id: string, newTitle: string) => {
    try {
      await updateDoc(doc(db, 'chats', id), { title: newTitle });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `chats/${id}`);
    }
  };

  const [editingChatId, setEditingChatId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');

  const startEditing = (chat: Chat) => {
    setEditingChatId(chat.id);
    setEditTitle(chat.title);
  };

  const saveRename = () => {
    if (editingChatId && editTitle.trim()) {
      renameChat(editingChatId, editTitle.trim());
    }
    setEditingChatId(null);
  };

  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio?.hasSelectedApiKey) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
      }
    };
    checkKey();
  }, []);

  const openKeyDialog = async () => {
    if (window.aistudio?.openSelectKey) {
      await window.aistudio.openSelectKey();
      setHasKey(true);
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const base64 = (event.target?.result as string).split(',')[1];
      setSelectedFile({
        data: base64,
        mimeType: file.type,
        name: file.name
      });
    };
    reader.readAsDataURL(file);
  };

  const toggleLiveMode = async () => {
    if (isLiveActive) {
      sessionRef.current?.close();
      streamRef.current?.getTracks().forEach(t => t.stop());
      audioContextRef.current?.close();
      setIsLiveActive(false);
      setIsLiveMode(false);
      return;
    }

    try {
      setIsLiveMode(true);
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      const audioContext = new AudioContext({ sampleRate: 16000 });
      audioContextRef.current = audioContext;
      
      const session = await ai.live.connect({
        model: "gemini-2.5-flash-native-audio-preview-12-2025",
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: "You are having a real-time voice conversation. Be concise and friendly.",
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Zephyr" } }
          }
        },
        callbacks: {
          onopen: () => {
            setIsLiveActive(true);
            // Start streaming
            const source = audioContext.createMediaStreamSource(stream);
            const processor = audioContext.createScriptProcessor(4096, 1, 1);
            source.connect(processor);
            processor.connect(audioContext.destination);
            
            processor.onaudioprocess = (e) => {
              if (session) {
                const inputData = e.inputBuffer.getChannelData(0);
                const pcmData = new Int16Array(inputData.length);
                for (let i = 0; i < inputData.length; i++) {
                  pcmData[i] = Math.max(-1, Math.min(1, inputData[i])) * 0x7FFF;
                }
                const base64 = btoa(String.fromCharCode(...new Uint8Array(pcmData.buffer)));
                session.sendRealtimeInput({ audio: { data: base64, mimeType: 'audio/pcm;rate=16000' } });
              }
            };
          },
          onmessage: (msg: any) => {
            if (msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data) {
              const base64 = msg.serverContent.modelTurn.parts[0].inlineData.data;
              const binary = atob(base64);
              const pcm = new Int16Array(binary.length / 2);
              for (let i = 0; i < pcm.length; i++) {
                pcm[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8);
              }
              audioQueueRef.current.push(pcm);
              playNextInQueue();
            }
            if (msg.serverContent?.interrupted) {
              audioQueueRef.current = [];
              isPlayingRef.current = false;
            }
          },
          onclose: () => setIsLiveActive(false),
          onerror: (err) => console.error("Live API Error:", err)
        }
      });
      sessionRef.current = session;
    } catch (err) {
      console.error("Failed to start Live Mode:", err);
      setIsLiveMode(false);
    }
  };

  const playNextInQueue = () => {
    if (isPlayingRef.current || audioQueueRef.current.length === 0 || !audioContextRef.current) return;
    
    isPlayingRef.current = true;
    const pcm = audioQueueRef.current.shift()!;
    const buffer = audioContextRef.current.createBuffer(1, pcm.length, 16000);
    const channelData = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) {
      channelData[i] = pcm[i] / 0x7FFF;
    }
    
    const source = audioContextRef.current.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContextRef.current.destination);
    source.onended = () => {
      isPlayingRef.current = false;
      playNextInQueue();
    };
    source.start();
  };
  const handleSend = async (textToSend?: string) => {
    const finalInput = textToSend || input;
    
    if (!finalInput.trim() && !selectedFile) {
      if (!textToSend) setValidationError("Message cannot be empty");
      return;
    }
    
    if (finalInput.length > MAX_MESSAGE_LENGTH) {
      setValidationError(`Message is too long (max ${MAX_MESSAGE_LENGTH} characters)`);
      return;
    }

    if (isLoading || !user || !currentChatId) return;

    setValidationError(null);
    setIsLoading(true);

    const userMessage: Message = {
      id: Date.now().toString(),
      text: finalInput,
      sender: 'user',
      url: selectedFile ? `data:${selectedFile.mimeType};base64,${selectedFile.data}` : undefined,
      type: selectedFile?.mimeType.startsWith('image') ? 'image' : selectedFile?.mimeType.startsWith('video') ? 'video' : 'text',
      createdAt: Date.now()
    };

    const isFirstUserMessage = messages.length === 0 || (messages.length === 1 && messages[0].id === '1');
    
    // Set a temporary title if it's the first message
    const tempTitle = isFirstUserMessage ? (finalInput.slice(0, 30) || "File Analysis") : currentChat?.title;

    try {
      await setDoc(doc(db, 'chats', currentChatId, 'messages', userMessage.id), userMessage);
      await updateDoc(doc(db, 'chats', currentChatId), {
        title: tempTitle,
        lastMessage: finalInput
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `chats/${currentChatId}`);
    }

    setInput('');
    const currentFile = selectedFile;
    setSelectedFile(null);

    try {
      let responseText = "";
      let responseType: 'text' | 'image' | 'video' | 'audio' = 'text';
      let responseUrl = "";
      let grounding: any[] = [];

      // Logic to determine which function to call
      const lowerInput = finalInput.toLowerCase();
      
      if (lowerInput.includes("generate image") || lowerInput.includes("create image")) {
        if (!hasKey) {
          responseText = "Please select an API key to generate high-quality images.";
          openKeyDialog();
        } else {
          const url = await generateImage(finalInput, imageConfig);
          if (url) {
            responseType = 'image';
            responseUrl = url;
            responseText = "Here is the image I generated for you.";
          } else {
            responseText = "I couldn't generate the image. Please try a different prompt.";
          }
        }
      } else if (lowerInput.includes("generate video") || lowerInput.includes("create video")) {
        if (!hasKey) {
          responseText = "Please select an API key to generate videos.";
          openKeyDialog();
        } else {
          const url = await generateVideo(finalInput, videoConfig);
          if (url) {
            responseType = 'video';
            responseUrl = url;
            responseText = "Here is the video I generated for you.";
          } else {
            responseText = "I couldn't generate the video. Please try a different prompt.";
          }
        }
      } else if (currentFile) {
        responseText = await analyzeMultimodal(finalInput || "Analyze this file", currentFile);
      } else {
        const model = isThinkingMode ? "gemini-3.1-pro-preview" : "gemini-3-flash-preview";
        const config: any = {};
        if (isThinkingMode) config.thinkingConfig = { thinkingLevel: ThinkingLevel.HIGH };
        if (isGroundingEnabled) config.tools = [{ googleSearch: {} }, { googleMaps: {} }];

        const response = await ai.models.generateContent({
          model: model,
          contents: finalInput,
          config: {
            systemInstruction: "You are MiniGPT, a friendly AI assistant.",
            ...config
          }
        });
        responseText = response.text || "";
        
        // Extract grounding
        const chunks = response.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (chunks) {
          grounding = chunks.map((c: any) => ({
            title: c.web?.title || c.maps?.title || "Source",
            url: c.web?.uri || c.maps?.uri
          }));
        }
      }

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        text: responseText,
        sender: 'bot',
        type: responseType,
        url: responseUrl,
        grounding: grounding.length > 0 ? grounding : undefined,
        createdAt: Date.now()
      };

      // TTS if enabled
      if (isTTSEnabled && responseType === 'text') {
        const audioUrl = await textToSpeech(responseText);
        if (audioUrl) {
          botMessage.type = 'audio';
          botMessage.url = audioUrl;
        }
      }
      
      // Update messages AND generate AI title if it's the first exchange
      if (isFirstUserMessage) {
        const aiTitle = await generateChatTitle(finalInput, responseText);
        await updateDoc(doc(db, 'chats', currentChatId), {
          title: aiTitle,
          lastMessage: responseText
        });
      } else {
        await updateDoc(doc(db, 'chats', currentChatId), {
          lastMessage: responseText
        });
      }

      await setDoc(doc(db, 'chats', currentChatId, 'messages', botMessage.id), botMessage);
    } catch (error) {
      const errorId = (Date.now() + 1).toString();
      const errorMessage: Message = {
        id: errorId,
        text: "I'm sorry, I encountered an error processing your request.",
        sender: 'bot',
        createdAt: Date.now()
      };
      try {
        await setDoc(doc(db, 'chats', currentChatId, 'messages', errorId), errorMessage);
        await updateDoc(doc(db, 'chats', currentChatId), {
          lastMessage: errorMessage.text
        });
      } catch (err) {
        console.error("Failed to write error message:", err);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const SUGGESTIONS = [
    "Write a Python script to scrape a website",
    "Explain quantum computing in simple terms",
    "How do I make a perfect chocolate cake?",
    "Translate 'Hello, how are you?' to Japanese"
  ];

  if (!isAuthReady) {
    return (
      <div className="flex items-center justify-center h-screen bg-zinc-50">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-zinc-50 p-6 text-center">
        <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center shadow-2xl shadow-zinc-200 mb-8">
          <Bot className="text-white w-10 h-10" />
        </div>
        <h1 className="text-3xl font-bold mb-2">Welcome to MiniGPT</h1>
        <p className="text-zinc-500 mb-8 max-w-md">
          Sign in to start chatting with your AI assistant and save your conversations.
        </p>
        <button 
          onClick={login}
          className="flex items-center gap-3 px-8 py-4 bg-zinc-900 text-white rounded-2xl font-bold shadow-xl shadow-zinc-200 hover:scale-105 transition-transform"
        >
          <LogIn className="w-5 h-5" />
          Sign in with Google
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-screen bg-zinc-50 font-sans text-zinc-900 overflow-hidden">
      {/* Sidebar */}
      <AnimatePresence mode="wait">
        {isSidebarOpen && (
          <motion.aside
            initial={{ x: -300, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: -300, opacity: 0 }}
            className="fixed md:relative z-50 w-72 h-full bg-zinc-900 text-zinc-300 flex flex-col border-r border-zinc-800"
          >
            <div className="p-4 flex items-center justify-between border-b border-zinc-800">
              <div className="flex items-center gap-2">
                <Bot className="w-6 h-6 text-white" />
                <span className="font-bold text-white tracking-tight">MiniGPT</span>
              </div>
              <button 
                onClick={() => setIsSidebarOpen(false)}
                className="md:hidden p-1 hover:bg-zinc-800 rounded-lg transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4">
              <button
                onClick={createNewChat}
                className="w-full flex items-center gap-2 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl transition-all font-medium text-sm border border-zinc-700 shadow-sm"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-2 space-y-1">
              {chats.map(chat => (
                <div
                  key={chat.id}
                  onClick={() => {
                    setCurrentChatId(chat.id);
                    if (window.innerWidth < 768) setIsSidebarOpen(false);
                  }}
                  className={`w-full group flex items-center justify-between px-3 py-3 rounded-xl transition-all text-sm cursor-pointer ${
                    currentChatId === chat.id 
                      ? 'bg-zinc-800 text-white' 
                      : 'hover:bg-zinc-800/50 text-zinc-400 hover:text-zinc-200'
                  }`}
                >
                  <div className="flex items-center gap-3 truncate flex-1">
                    <MessageSquare className="w-4 h-4 shrink-0" />
                    {editingChatId === chat.id ? (
                      <input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={saveRename}
                        onKeyDown={(e) => e.key === 'Enter' && saveRename()}
                        className="bg-zinc-700 text-white px-1 rounded outline-none w-full"
                      />
                    ) : (
                      <span className="truncate">{chat.title}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                    <button
                      onClick={(e) => { e.stopPropagation(); startEditing(chat); }}
                      className="p-1 hover:text-white transition-all"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                    <button
                      onClick={(e) => deleteChat(chat.id, e)}
                      className="p-1 hover:text-red-400 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="p-4 border-t border-zinc-800 relative">
              <AnimatePresence>
                {isUserMenuOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: 10, scale: 0.95 }}
                    className="absolute bottom-full left-4 right-4 mb-2 bg-zinc-800 border border-zinc-700 rounded-2xl shadow-2xl overflow-hidden z-[60]"
                  >
                    <div className="p-3 border-b border-zinc-700">
                      <div className="flex items-center gap-3 px-2 py-1">
                        <div className="w-10 h-10 rounded-full bg-zinc-700 flex items-center justify-center text-xs font-bold text-white uppercase">
                          {user.displayName?.slice(0, 2)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-bold text-white truncate">{user.displayName}</p>
                          <p className="text-[10px] text-zinc-400 font-bold uppercase tracking-widest">Free Plan</p>
                        </div>
                      </div>
                    </div>

                    <div className="p-2 space-y-1">
                      <button 
                        onClick={addAnotherAccount}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white rounded-xl transition-all"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>Add another account</span>
                      </button>
                      <div className="h-px bg-zinc-700 mx-2 my-1" />
                      <button 
                        onClick={() => { setIsUpgradeOpen(true); setIsUserMenuOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white rounded-xl transition-all"
                      >
                        <Zap className="w-4 h-4" />
                        <span>Upgrade plan</span>
                      </button>
                      <button 
                        onClick={() => { setIsPersonalizationOpen(true); setIsUserMenuOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white rounded-xl transition-all"
                      >
                        <Palette className="w-4 h-4" />
                        <span>Personalization</span>
                      </button>
                      <button 
                        onClick={() => { setIsProfileOpen(true); setIsUserMenuOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white rounded-xl transition-all"
                      >
                        <User className="w-4 h-4" />
                        <span>Profile</span>
                      </button>
                      <button 
                        onClick={() => { setIsSettingsOpen(true); setIsUserMenuOpen(false); }}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white rounded-xl transition-all"
                      >
                        <Settings className="w-4 h-4" />
                        <span>Settings</span>
                      </button>
                      <div className="h-px bg-zinc-700 mx-2 my-1" />
                      <button 
                        onClick={() => { setIsHelpOpen(true); setIsUserMenuOpen(false); }}
                        className="w-full flex items-center justify-between px-3 py-2 text-sm text-zinc-300 hover:bg-zinc-700 hover:text-white rounded-xl transition-all group"
                      >
                        <div className="flex items-center gap-3">
                          <LifeBuoy className="w-4 h-4" />
                          <span>Help</span>
                        </div>
                        <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-all" />
                      </button>
                      <button 
                        onClick={logout}
                        className="w-full flex items-center gap-3 px-3 py-2 text-sm text-red-400 hover:bg-red-500/10 rounded-xl transition-all"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>Log out</span>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              <button 
                onClick={() => setIsUserMenuOpen(!isUserMenuOpen)}
                className={`w-full flex items-center justify-between p-2 rounded-2xl transition-all ${isUserMenuOpen ? 'bg-zinc-800' : 'hover:bg-zinc-800/50'}`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-full border border-zinc-700" referrerPolicy="no-referrer" />
                  <div className="text-left min-w-0">
                    <p className="text-xs font-bold text-white truncate">{user.displayName}</p>
                    <p className="text-[10px] text-zinc-500 font-bold uppercase tracking-tighter">Free Plan</p>
                  </div>
                </div>
                <ChevronUp className={`w-4 h-4 text-zinc-500 transition-transform ${isUserMenuOpen ? 'rotate-180' : ''}`} />
              </button>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Header */}
        <header className="flex items-center justify-between px-6 py-4 bg-white border-b border-zinc-200 shrink-0">
          <div className="flex items-center gap-4">
            {!isSidebarOpen && (
              <button 
                onClick={() => setIsSidebarOpen(true)}
                className="p-2 hover:bg-zinc-100 rounded-xl transition-colors"
              >
                <Menu className="w-5 h-5" />
              </button>
            )}
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">
                {currentChat?.title || 'MiniGPT'}
              </h1>
              <div className="flex gap-2 mt-1">
                {isThinkingMode && <span className="text-[8px] bg-zinc-900 text-white px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest">Thinking</span>}
                {isGroundingEnabled && <span className="text-[8px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded-full font-bold uppercase tracking-widest">Search</span>}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={toggleLiveMode}
              className={`p-2 rounded-xl transition-all ${isLiveActive ? 'bg-red-500 text-white animate-pulse' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
              title="Live Voice Mode"
            >
              <Sparkles className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setIsThinkingMode(!isThinkingMode)}
              className={`p-2 rounded-xl transition-all ${isThinkingMode ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
              title="Thinking Mode"
            >
              <Brain className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setIsTTSEnabled(!isTTSEnabled)}
              className={`p-2 rounded-xl transition-all ${isTTSEnabled ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500 hover:bg-zinc-200'}`}
              title="TTS Mode"
            >
              <Volume2 className="w-4 h-4" />
            </button>
            <button 
              onClick={() => setIsSettingsOpen(true)}
              className="p-2 bg-zinc-100 text-zinc-500 hover:bg-zinc-200 rounded-xl transition-all"
              title="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <div className="w-10 h-10 bg-zinc-900 rounded-xl flex items-center justify-center shadow-lg shadow-zinc-200 ml-2">
              <Bot className="text-white w-6 h-6" />
            </div>
          </div>
        </header>

        {/* Chat Area */}
        <main className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 scroll-smooth">
          <div className="max-w-3xl mx-auto space-y-8">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-20 text-center space-y-8">
                <div className="w-20 h-20 bg-zinc-900 rounded-3xl flex items-center justify-center shadow-2xl shadow-zinc-200 animate-bounce">
                  <Bot className="text-white w-10 h-10" />
                </div>
                <div className="space-y-2">
                  <h2 className="text-3xl font-bold tracking-tight">Welcome to MiniGPT</h2>
                  <p className="text-zinc-500 max-w-md mx-auto">
                    Your versatile AI assistant for coding, translation, and creative writing.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 w-full max-w-2xl">
                  {SUGGESTIONS.map((suggestion, i) => (
                    <button
                      key={i}
                      onClick={() => handleSend(suggestion)}
                      className="p-4 bg-white border border-zinc-200 rounded-2xl text-sm text-left hover:border-zinc-900 hover:shadow-md transition-all group"
                    >
                      <p className="text-zinc-600 group-hover:text-zinc-900">{suggestion}</p>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-8">
                {hasMoreMessages && (
                  <div className="flex justify-center pt-4">
                    <button 
                      onClick={loadMoreMessages}
                      disabled={isMessagesLoading}
                      className="px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-600 rounded-xl text-xs font-bold uppercase tracking-widest transition-all disabled:opacity-50"
                    >
                      {isMessagesLoading ? 'Loading...' : 'Load Older Messages'}
                    </button>
                  </div>
                )}
                
                <AnimatePresence initial={false}>
                  {messages.map((message) => (
                    <motion.div
                      key={message.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`flex gap-4 max-w-[90%] md:max-w-[80%] ${message.sender === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
                        <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
                          message.sender === 'user' ? 'bg-zinc-200' : 'bg-zinc-900'
                        }`}>
                          {message.sender === 'user' ? <User className="w-5 h-5 text-zinc-600" /> : <Bot className="w-5 h-5 text-white" />}
                        </div>
                        <div className="flex flex-col gap-2 min-w-0">
                          <div className={`px-5 py-4 rounded-2xl text-sm leading-relaxed relative group shadow-sm ${
                            message.sender === 'user' 
                              ? 'bg-zinc-900 text-white rounded-tr-none' 
                              : 'bg-white border border-zinc-200 text-zinc-800 rounded-tl-none'
                          }`}>
                            {message.url && message.type === 'image' && (
                              <img src={message.url} alt="Generated" className="rounded-lg mb-2 max-w-full h-auto" referrerPolicy="no-referrer" />
                            )}
                            {message.url && message.type === 'video' && (
                              <video src={message.url} controls className="rounded-lg mb-2 max-w-full h-auto" />
                            )}
                            {message.url && message.type === 'audio' && (
                              <audio src={message.url} controls className="w-full mb-2" />
                            )}
                            
                            <div className="markdown-body prose prose-zinc prose-sm max-w-none dark:prose-invert">
                              <ReactMarkdown
                                components={{
                                  code({ node, inline, className, children, ...props }: any) {
                                    const match = /language-(\w+)/.exec(className || '');
                                    return !inline && match ? (
                                      <SyntaxHighlighter
                                        style={vscDarkPlus}
                                        language={match[1]}
                                        PreTag="div"
                                        {...props}
                                      >
                                        {String(children).replace(/\n$/, '')}
                                      </SyntaxHighlighter>
                                    ) : (
                                      <code className={className} {...props}>
                                        {children}
                                      </code>
                                    );
                                  },
                                }}
                              >
                                {message.text}
                              </ReactMarkdown>
                            </div>

                            {message.grounding && (
                              <div className="mt-4 pt-4 border-t border-zinc-100 space-y-2">
                                <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Sources</p>
                                <div className="flex flex-wrap gap-2">
                                  {message.grounding.map((source, i) => (
                                    <a 
                                      key={i} 
                                      href={source.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="flex items-center gap-1.5 px-2 py-1 bg-zinc-50 border border-zinc-200 rounded-lg text-[10px] text-zinc-600 hover:border-zinc-900 transition-all"
                                    >
                                      <Search className="w-3 h-3" />
                                      {source.title}
                                    </a>
                                  ))}
                                </div>
                              </div>
                            )}
                            
                            {message.sender === 'bot' && (
                              <button
                                onClick={() => copyToClipboard(message.text, message.id)}
                                className="absolute -right-10 top-0 p-2 text-zinc-400 hover:text-zinc-900 transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
                                title="Copy to clipboard"
                              >
                                {copiedId === message.id ? (
                                  <Check className="w-4 h-4 text-green-500" />
                                ) : (
                                  <Copy className="w-4 h-4" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}
            {isLoading && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start"
              >
                <div className="flex gap-4 items-center text-zinc-400">
                  <div className="w-9 h-9 rounded-xl bg-zinc-100 flex items-center justify-center">
                    <Loader2 className="w-5 h-5 animate-spin" />
                  </div>
                  <span className="text-xs font-bold italic tracking-tight">MiniGPT is processing...</span>
                </div>
              </motion.div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </main>

        {/* Input Area */}
        <footer className="p-4 md:p-8 bg-white border-t border-zinc-200 shrink-0">
          <div className="max-w-3xl mx-auto space-y-4">
            {selectedFile && (
              <div className="flex items-center gap-3 p-3 bg-zinc-100 rounded-2xl">
                <div className="w-10 h-10 bg-zinc-200 rounded-lg flex items-center justify-center">
                  {selectedFile.mimeType.startsWith('image') ? <ImageIcon className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold truncate">{selectedFile.name}</p>
                  <p className="text-[10px] text-zinc-400 uppercase">{selectedFile.mimeType}</p>
                </div>
                <button onClick={() => setSelectedFile(null)} className="p-1 hover:bg-zinc-200 rounded-full">
                  <X className="w-4 h-4" />
                </button>
              </div>
            )}

            <div className="relative flex gap-3 items-center">
              <div className="relative flex-1">
                <div className="absolute left-2 top-1/2 -translate-y-1/2 flex gap-1">
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    className="p-2 text-zinc-400 hover:text-zinc-900 transition-colors"
                  >
                    <Paperclip className="w-5 h-5" />
                  </button>
                  <input 
                    type="file" 
                    ref={fileInputRef} 
                    onChange={handleFileUpload} 
                    className="hidden" 
                    accept="image/*,video/*,audio/*"
                  />
                </div>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                  placeholder={isListening ? "Listening..." : "Type your message here..."}
                  className={`w-full pl-12 pr-14 py-4 bg-zinc-100 border-none rounded-2xl text-sm focus:ring-2 focus:ring-zinc-900 transition-all outline-none shadow-inner ${
                    isListening ? 'ring-2 ring-red-400 animate-pulse' : ''
                  } ${validationError ? 'ring-2 ring-red-500' : ''}`}
                />
                <button
                  onClick={() => handleSend()}
                  disabled={(!input.trim() && !selectedFile) || isLoading || input.length > MAX_MESSAGE_LENGTH}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-2.5 bg-zinc-900 text-white rounded-xl disabled:opacity-50 disabled:cursor-not-allowed transition-all hover:scale-105 active:scale-95 shadow-md"
                >
                  <Send className="w-5 h-5" />
                </button>
              </div>
              
              <button
                onClick={toggleListening}
                disabled={isLoading}
                className={`p-4 rounded-2xl transition-all shadow-sm ${
                  isListening 
                    ? 'bg-red-500 text-white shadow-lg shadow-red-200 scale-110' 
                    : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200'
                }`}
                title={isListening ? "Stop listening" : "Start voice input"}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
              </button>
            </div>

            <div className="flex justify-between items-center px-2">
              <div className="flex-1">
                {validationError && (
                  <motion.p 
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-[10px] text-red-500 font-bold uppercase tracking-wider"
                  >
                    {validationError}
                  </motion.p>
                )}
              </div>
              <div className={`text-[10px] font-bold uppercase tracking-wider ${
                input.length > MAX_MESSAGE_LENGTH ? 'text-red-500' : 'text-zinc-400'
              }`}>
                {input.length} / {MAX_MESSAGE_LENGTH}
              </div>
            </div>
          </div>
          <p className="text-center text-[10px] text-zinc-400 mt-4 uppercase tracking-[0.2em] font-bold">
            MiniGPT • Multilingual • Code Support • Voice Input
          </p>
        </footer>
      </div>

      {/* Live Mode Overlay */}
      <AnimatePresence>
        {isLiveMode && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-zinc-900 flex flex-col items-center justify-center text-white p-8"
          >
            <div className="relative">
              <div className={`w-48 h-48 rounded-full border-4 border-white/20 flex items-center justify-center ${isLiveActive ? 'animate-ping opacity-20' : ''}`} />
              <div className="absolute inset-0 flex items-center justify-center">
                <div className={`w-32 h-32 rounded-full bg-white flex items-center justify-center shadow-2xl ${isLiveActive ? 'scale-110' : ''} transition-transform duration-500`}>
                  <Bot className="w-16 h-16 text-zinc-900" />
                </div>
              </div>
            </div>
            
            <div className="mt-12 text-center space-y-4">
              <h2 className="text-2xl font-bold tracking-tight">
                {isLiveActive ? "Listening..." : "Connecting..."}
              </h2>
              <p className="text-zinc-400 max-w-xs mx-auto text-sm">
                Speak naturally to MiniGPT. Your conversation is real-time and low-latency.
              </p>
            </div>

            <button 
              onClick={toggleLiveMode}
              className="mt-16 p-6 bg-white/10 hover:bg-white/20 rounded-full transition-all group"
            >
              <X className="w-8 h-8 group-hover:scale-110 transition-transform" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Profile Modal */}
      <AnimatePresence>
        {isProfileOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                <h3 className="font-bold text-lg">Your Profile</h3>
                <button onClick={() => setIsProfileOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-8 flex flex-col items-center text-center space-y-4">
                <img src={user.photoURL || ''} alt="" className="w-24 h-24 rounded-full border-4 border-zinc-100 shadow-xl" referrerPolicy="no-referrer" />
                <div>
                  <h4 className="text-xl font-bold">{user.displayName}</h4>
                  <p className="text-zinc-500 text-sm">{user.email}</p>
                </div>
                <div className="w-full pt-6 space-y-3">
                  <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <span className="text-xs font-bold text-zinc-400 uppercase">User ID</span>
                    <span className="text-xs font-mono text-zinc-600">{user.uid.slice(0, 12)}...</span>
                  </div>
                  <div className="flex items-center justify-between p-4 bg-zinc-50 rounded-2xl border border-zinc-100">
                    <span className="text-xs font-bold text-zinc-400 uppercase">Account Type</span>
                    <span className="text-xs font-bold text-zinc-900">Free Tier</span>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Personalization Modal */}
      <AnimatePresence>
        {isPersonalizationOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                <h3 className="font-bold text-lg">Personalization</h3>
                <button onClick={() => setIsPersonalizationOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">AI Personality</p>
                  <div className="grid grid-cols-2 gap-3">
                    {['Friendly', 'Professional', 'Creative', 'Concise'].map(p => (
                      <button key={p} className="p-3 bg-zinc-50 border border-zinc-100 rounded-xl text-sm font-medium hover:border-zinc-900 transition-all">
                        {p}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Theme</p>
                  <div className="flex gap-3">
                    <button className="flex-1 p-3 bg-zinc-900 text-white rounded-xl text-sm font-medium">Dark</button>
                    <button className="flex-1 p-3 bg-zinc-100 text-zinc-900 rounded-xl text-sm font-medium">Light</button>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Upgrade Modal */}
      <AnimatePresence>
        {isUpgradeOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-lg rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                <h3 className="font-bold text-lg">Upgrade Your Plan</h3>
                <button onClick={() => setIsUpgradeOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-8 grid md:grid-cols-2 gap-6">
                <div className="p-6 bg-zinc-50 rounded-3xl border border-zinc-100 space-y-4">
                  <h4 className="font-bold text-zinc-400 uppercase text-[10px] tracking-widest">Current</h4>
                  <div className="space-y-1">
                    <p className="text-2xl font-bold">Free</p>
                    <p className="text-zinc-500 text-sm">$0 / month</p>
                  </div>
                  <ul className="text-xs space-y-2 text-zinc-600">
                    <li className="flex items-center gap-2"><Check className="w-3 h-3 text-green-500" /> Standard Models</li>
                    <li className="flex items-center gap-2"><Check className="w-3 h-3 text-green-500" /> Basic Search</li>
                    <li className="flex items-center gap-2"><Check className="w-3 h-3 text-green-500" /> Limited Image Gen</li>
                  </ul>
                </div>
                <div className="p-6 bg-zinc-900 rounded-3xl text-white space-y-4 shadow-xl shadow-zinc-200">
                  <h4 className="font-bold text-zinc-500 uppercase text-[10px] tracking-widest">Pro</h4>
                  <div className="space-y-1">
                    <p className="text-2xl font-bold">$20</p>
                    <p className="text-zinc-400 text-sm">/ month</p>
                  </div>
                  <ul className="text-xs space-y-2 text-zinc-300">
                    <li className="flex items-center gap-2"><Zap className="w-3 h-3 text-yellow-400" /> Ultra-Fast Models</li>
                    <li className="flex items-center gap-2"><Zap className="w-3 h-3 text-yellow-400" /> Advanced Reasoning</li>
                    <li className="flex items-center gap-2"><Zap className="w-3 h-3 text-yellow-400" /> Unlimited Media Gen</li>
                  </ul>
                  <button className="w-full py-3 bg-white text-zinc-900 rounded-xl font-bold text-sm hover:scale-[1.02] transition-all">
                    Upgrade Now
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Help Modal */}
      <AnimatePresence>
        {isHelpOpen && (
          <div className="fixed inset-0 z-[300] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                <h3 className="font-bold text-lg">Help & Support</h3>
                <button onClick={() => setIsHelpOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-4">
                {[
                  { q: "How do I generate images?", a: "Just type 'generate an image of...' in the chat." },
                  { q: "What is Thinking Mode?", a: "It uses a more powerful model for complex reasoning." },
                  { q: "How do I use Live Voice?", a: "Click the sparkles icon in the header to start talking." },
                  { q: "Is my data secure?", a: "Yes, we use industry-standard encryption and Firebase security." }
                ].map((item, i) => (
                  <div key={i} className="p-4 bg-zinc-50 rounded-2xl border border-zinc-100 space-y-1">
                    <p className="text-sm font-bold">{item.q}</p>
                    <p className="text-xs text-zinc-500 leading-relaxed">{item.a}</p>
                  </div>
                ))}
                <button className="w-full py-4 bg-zinc-100 text-zinc-900 rounded-2xl font-bold text-sm hover:bg-zinc-200 transition-all flex items-center justify-center gap-2">
                  <LifeBuoy className="w-4 h-4" />
                  Contact Support
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Settings Modal */}
      <AnimatePresence>
        {isSettingsOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl"
            >
              <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                <h2 className="font-bold text-xl tracking-tight">Settings</h2>
                <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-zinc-100 rounded-xl transition-colors">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 space-y-6">
                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Image Generation</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-500 font-bold uppercase">Aspect Ratio</label>
                      <select 
                        value={imageConfig.aspectRatio} 
                        onChange={(e) => setImageConfig({...imageConfig, aspectRatio: e.target.value})}
                        className="w-full bg-zinc-100 border-none rounded-xl p-2 text-xs outline-none focus:ring-2 focus:ring-zinc-900"
                      >
                        {['1:1', '3:4', '4:3', '9:16', '16:9', '2:3', '3:2', '21:9'].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-500 font-bold uppercase">Quality</label>
                      <select 
                        value={imageConfig.imageSize} 
                        onChange={(e) => setImageConfig({...imageConfig, imageSize: e.target.value})}
                        className="w-full bg-zinc-100 border-none rounded-xl p-2 text-xs outline-none focus:ring-2 focus:ring-zinc-900"
                      >
                        {['1K', '2K', '4K'].map(q => <option key={q} value={q}>{q}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Video Generation</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-500 font-bold uppercase">Aspect Ratio</label>
                      <select 
                        value={videoConfig.aspectRatio} 
                        onChange={(e) => setVideoConfig({...videoConfig, aspectRatio: e.target.value})}
                        className="w-full bg-zinc-100 border-none rounded-xl p-2 text-xs outline-none focus:ring-2 focus:ring-zinc-900"
                      >
                        {['16:9', '9:16'].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[10px] text-zinc-500 font-bold uppercase">Resolution</label>
                      <select 
                        value={videoConfig.resolution} 
                        onChange={(e) => setVideoConfig({...videoConfig, resolution: e.target.value})}
                        className="w-full bg-zinc-100 border-none rounded-xl p-2 text-xs outline-none focus:ring-2 focus:ring-zinc-900"
                      >
                        {['720p', '1080p'].map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-zinc-100">
                  <button 
                    onClick={openKeyDialog}
                    className="w-full py-3 bg-zinc-900 text-white rounded-2xl font-bold text-sm hover:scale-[1.02] transition-all shadow-lg shadow-zinc-200"
                  >
                    {hasKey ? "Update API Key" : "Select API Key"}
                  </button>
                  <p className="text-[10px] text-zinc-400 mt-2 text-center">Required for Veo and High-Quality Images</p>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ChatApp />
    </ErrorBoundary>
  );
}
