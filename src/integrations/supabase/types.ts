export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      chat_messages: {
        Row: {
          content: string
          created_at: string
          id: string
          job_id: string | null
          role: string
          user_id: string
        }
        Insert: {
          content: string
          created_at?: string
          id?: string
          job_id?: string | null
          role: string
          user_id: string
        }
        Update: {
          content?: string
          created_at?: string
          id?: string
          job_id?: string | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "jobs"
            referencedColumns: ["id"]
          },
        ]
      }
      debug_logs: {
        Row: {
          created_at: string
          debug_id: string
          file_name: string | null
          function_name: string | null
          id: string
          message: string
          module: string
          raw_details: Json | null
          severity: string
          stack_trace: string | null
          suggested_fix: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string
          debug_id: string
          file_name?: string | null
          function_name?: string | null
          id?: string
          message: string
          module: string
          raw_details?: Json | null
          severity: string
          stack_trace?: string | null
          suggested_fix?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string
          debug_id?: string
          file_name?: string | null
          function_name?: string | null
          id?: string
          message?: string
          module?: string
          raw_details?: Json | null
          severity?: string
          stack_trace?: string | null
          suggested_fix?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      jobs: {
        Row: {
          ai_risk: string | null
          alert_date: string | null
          applied_at: string | null
          company: string | null
          company_domain: string | null
          company_research: string | null
          contacts: Json | null
          cover_letter: string | null
          created_at: string | null
          description: string | null
          exp_required: string | null
          feedback: string | null
          feedback_reason: string | null
          fingerprint: string | null
          hiring_probability: number | null
          id: string
          interview_prep: string | null
          job_link: string | null
          linkedin_id: string | null
          location: string | null
          next_action: string | null
          next_action_due_at: string | null
          priority: string | null
          reason: string | null
          role: string | null
          score: number | null
          status: string | null
          tailored_cv: string | null
          tailored_cv_filename: string | null
          tailored_cv_url: string | null
          user_id: string | null
          user_score: number | null
        }
        Insert: {
          ai_risk?: string | null
          alert_date?: string | null
          applied_at?: string | null
          company?: string | null
          company_domain?: string | null
          company_research?: string | null
          contacts?: Json | null
          cover_letter?: string | null
          created_at?: string | null
          description?: string | null
          exp_required?: string | null
          feedback?: string | null
          feedback_reason?: string | null
          fingerprint?: string | null
          hiring_probability?: number | null
          id?: string
          interview_prep?: string | null
          job_link?: string | null
          linkedin_id?: string | null
          location?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          priority?: string | null
          reason?: string | null
          role?: string | null
          score?: number | null
          status?: string | null
          tailored_cv?: string | null
          tailored_cv_filename?: string | null
          tailored_cv_url?: string | null
          user_id?: string | null
          user_score?: number | null
        }
        Update: {
          ai_risk?: string | null
          alert_date?: string | null
          applied_at?: string | null
          company?: string | null
          company_domain?: string | null
          company_research?: string | null
          contacts?: Json | null
          cover_letter?: string | null
          created_at?: string | null
          description?: string | null
          exp_required?: string | null
          feedback?: string | null
          feedback_reason?: string | null
          fingerprint?: string | null
          hiring_probability?: number | null
          id?: string
          interview_prep?: string | null
          job_link?: string | null
          linkedin_id?: string | null
          location?: string | null
          next_action?: string | null
          next_action_due_at?: string | null
          priority?: string | null
          reason?: string | null
          role?: string | null
          score?: number | null
          status?: string | null
          tailored_cv?: string | null
          tailored_cv_filename?: string | null
          tailored_cv_url?: string | null
          user_id?: string | null
          user_score?: number | null
        }
        Relationships: []
      }
      rate_limits: {
        Row: {
          called_at: string
          function_name: string
          id: string
          user_id: string
        }
        Insert: {
          called_at?: string
          function_name: string
          id?: string
          user_id: string
        }
        Update: {
          called_at?: string
          function_name?: string
          id?: string
          user_id?: string
        }
        Relationships: []
      }
      scan_runs: {
        Row: {
          error_text: string | null
          id: string
          jobs_added: number | null
          jobs_found: number | null
          started_at: string | null
          success: boolean | null
          user_id: string | null
        }
        Insert: {
          error_text?: string | null
          id?: string
          jobs_added?: number | null
          jobs_found?: number | null
          started_at?: string | null
          success?: boolean | null
          user_id?: string | null
        }
        Update: {
          error_text?: string | null
          id?: string
          jobs_added?: number | null
          jobs_found?: number | null
          started_at?: string | null
          success?: boolean | null
          user_id?: string | null
        }
        Relationships: []
      }
      scoring_metrics: {
        Row: {
          accuracy: number | null
          false_negatives: number | null
          false_positives: number | null
          id: string
          precision_score: number | null
          recall_score: number | null
          recorded_at: string | null
          total_feedback: number | null
          true_negatives: number | null
          true_positives: number | null
          user_id: string | null
        }
        Insert: {
          accuracy?: number | null
          false_negatives?: number | null
          false_positives?: number | null
          id?: string
          precision_score?: number | null
          recall_score?: number | null
          recorded_at?: string | null
          total_feedback?: number | null
          true_negatives?: number | null
          true_positives?: number | null
          user_id?: string | null
        }
        Update: {
          accuracy?: number | null
          false_negatives?: number | null
          false_positives?: number | null
          id?: string
          precision_score?: number | null
          recall_score?: number | null
          recorded_at?: string | null
          total_feedback?: number | null
          true_negatives?: number | null
          true_positives?: number | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scoring_metrics_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      security_reviews: {
        Row: {
          created_at: string
          findings: Json
          id: string
          source: string
          status: string
          summary: Json
          user_id: string
        }
        Insert: {
          created_at?: string
          findings: Json
          id?: string
          source?: string
          status?: string
          summary: Json
          user_id: string
        }
        Update: {
          created_at?: string
          findings?: Json
          id?: string
          source?: string
          status?: string
          summary?: Json
          user_id?: string
        }
        Relationships: []
      }
      user_profiles: {
        Row: {
          avatar_url: string | null
          candidate_profile: Json | null
          city: string | null
          created_at: string | null
          cv_filename: string | null
          cv_text: string | null
          cv_uploaded_at: string | null
          email: string | null
          full_name: string | null
          google_refresh_token: string | null
          home_city: string | null
          id: string
          is_admin: boolean
          last_email_scan_timestamp: number | null
          last_status_changes: Json | null
          last_status_sync_timestamp: number | null
          linkedin_url: string | null
          pending_status_changes: Json | null
          scheduled_scan_enabled: boolean | null
          scheduled_scan_hour: number | null
          scoring_feedback: Json | null
          vault_token_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          candidate_profile?: Json | null
          city?: string | null
          created_at?: string | null
          cv_filename?: string | null
          cv_text?: string | null
          cv_uploaded_at?: string | null
          email?: string | null
          full_name?: string | null
          google_refresh_token?: string | null
          home_city?: string | null
          id: string
          is_admin?: boolean
          last_email_scan_timestamp?: number | null
          last_status_changes?: Json | null
          last_status_sync_timestamp?: number | null
          linkedin_url?: string | null
          pending_status_changes?: Json | null
          scheduled_scan_enabled?: boolean | null
          scheduled_scan_hour?: number | null
          scoring_feedback?: Json | null
          vault_token_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          candidate_profile?: Json | null
          city?: string | null
          created_at?: string | null
          cv_filename?: string | null
          cv_text?: string | null
          cv_uploaded_at?: string | null
          email?: string | null
          full_name?: string | null
          google_refresh_token?: string | null
          home_city?: string | null
          id?: string
          is_admin?: boolean
          last_email_scan_timestamp?: number | null
          last_status_changes?: Json | null
          last_status_sync_timestamp?: number | null
          linkedin_url?: string | null
          pending_status_changes?: Json | null
          scheduled_scan_enabled?: boolean | null
          scheduled_scan_hour?: number | null
          scoring_feedback?: Json | null
          vault_token_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      delete_vault_secret: { Args: { secret_id: string }; Returns: undefined }
      get_decrypted_secret: { Args: { secret_id: string }; Returns: string }
      upsert_vault_secret: {
        Args: { p_name?: string; p_secret: string; p_secret_id: string }
        Returns: string
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
