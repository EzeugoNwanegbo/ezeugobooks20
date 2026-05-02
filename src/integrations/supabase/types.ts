export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      conversations: {
        Row: {
          created_at: string | null;
          id: string;
          title: string | null;
          updated_at: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          id?: string;
          title?: string | null;
          updated_at?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          id?: string;
          title?: string | null;
          updated_at?: string | null;
          user_id?: string;
        };
        Relationships: [];
      };
      documents: {
        Row: {
          created_at: string | null;
          extracted_text: string | null;
          file_name: string;
          file_size: number | null;
          file_type: string | null;
          folder_id: string | null;
          id: string;
          page_count: number | null;
          storage_path: string;
          suggested_subject: string | null;
          user_id: string;
        };
        Insert: {
          created_at?: string | null;
          extracted_text?: string | null;
          file_name: string;
          file_size?: number | null;
          file_type?: string | null;
          folder_id?: string | null;
          id?: string;
          page_count?: number | null;
          storage_path: string;
          suggested_subject?: string | null;
          user_id: string;
        };
        Update: {
          created_at?: string | null;
          extracted_text?: string | null;
          file_name?: string;
          file_size?: number | null;
          file_type?: string | null;
          folder_id?: string | null;
          id?: string;
          page_count?: number | null;
          storage_path?: string;
          suggested_subject?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "documents_folder_id_fkey";
            columns: ["folder_id"];
            isOneToOne: false;
            referencedRelation: "folders";
            referencedColumns: ["id"];
          },
        ];
      };
      document_chunks: {
        Row: {
          chunk_index: number;
          content: string;
          created_at: string | null;
          document_id: string;
          id: string;
          page_end: number | null;
          page_start: number | null;
          token_estimate: number | null;
          user_id: string;
        };
        Insert: {
          chunk_index: number;
          content: string;
          created_at?: string | null;
          document_id: string;
          id?: string;
          page_end?: number | null;
          page_start?: number | null;
          token_estimate?: number | null;
          user_id: string;
        };
        Update: {
          chunk_index?: number;
          content?: string;
          created_at?: string | null;
          document_id?: string;
          id?: string;
          page_end?: number | null;
          page_start?: number | null;
          token_estimate?: number | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "document_chunks_document_id_fkey";
            columns: ["document_id"];
            isOneToOne: false;
            referencedRelation: "documents";
            referencedColumns: ["id"];
          },
        ];
      };
      folders: {
        Row: {
          color: string | null;
          created_at: string;
          id: string;
          name: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          color?: string | null;
          created_at?: string;
          id?: string;
          name?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      messages: {
        Row: {
          content: string;
          conversation_id: string;
          created_at: string | null;
          id: string;
          mode: string | null;
          model_used: string | null;
          role: string;
          source_refs: Json | null;
          source_type: string | null;
          user_id: string;
        };
        Insert: {
          content: string;
          conversation_id: string;
          created_at?: string | null;
          id?: string;
          mode?: string | null;
          model_used?: string | null;
          role: string;
          source_refs?: Json | null;
          source_type?: string | null;
          user_id: string;
        };
        Update: {
          content?: string;
          conversation_id?: string;
          created_at?: string | null;
          id?: string;
          mode?: string | null;
          model_used?: string | null;
          role?: string;
          source_refs?: Json | null;
          source_type?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "messages_conversation_id_fkey";
            columns: ["conversation_id"];
            isOneToOne: false;
            referencedRelation: "conversations";
            referencedColumns: ["id"];
          },
        ];
      };
      user_profiles: {
        Row: {
          course: string | null;
          created_at: string | null;
          curriculum: string | null;
          exam_format: Database["public"]["Enums"]["exam_format"] | null;
          id: string;
          name: string | null;
          onboarded: boolean | null;
          preferred_mode: Database["public"]["Enums"]["response_mode"] | null;
          recent_topics: string[] | null;
          university: string | null;
          updated_at: string | null;
          weak_areas: string[] | null;
          year: string | null;
        };
        Insert: {
          course?: string | null;
          created_at?: string | null;
          curriculum?: string | null;
          exam_format?: Database["public"]["Enums"]["exam_format"] | null;
          id: string;
          name?: string | null;
          onboarded?: boolean | null;
          preferred_mode?: Database["public"]["Enums"]["response_mode"] | null;
          recent_topics?: string[] | null;
          university?: string | null;
          updated_at?: string | null;
          weak_areas?: string[] | null;
          year?: string | null;
        };
        Update: {
          course?: string | null;
          created_at?: string | null;
          curriculum?: string | null;
          exam_format?: Database["public"]["Enums"]["exam_format"] | null;
          id?: string;
          name?: string | null;
          onboarded?: boolean | null;
          preferred_mode?: Database["public"]["Enums"]["response_mode"] | null;
          recent_topics?: string[] | null;
          university?: string | null;
          updated_at?: string | null;
          weak_areas?: string[] | null;
          year?: string | null;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      search_document_chunks: {
        Args: {
          match_count?: number;
          match_document_ids?: string[] | null;
          query_terms: string[];
        };
        Returns: {
          chunk_index: number;
          content: string;
          document_id: string;
          file_name: string;
          folder: string | null;
          id: string;
          page_end: number | null;
          page_start: number | null;
          rank: number;
        }[];
      };
    };
    Enums: {
      exam_format: "MCQ" | "SAQ" | "OSCE" | "Viva";
      response_mode: "Simplified" | "Detailed";
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {
      exam_format: ["MCQ", "SAQ", "OSCE", "Viva"],
      response_mode: ["Simplified", "Detailed"],
    },
  },
} as const;
